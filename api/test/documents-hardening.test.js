"use strict";
// S5 evidence-store & web hardening tests:
//  - F-06: a stored text/html file downloads as a binary attachment with nosniff
//          (Content-Type degraded to octet-stream) — it can't render in our origin.
//  - F-07: a token supplied only in the ?token= query string is rejected.
//  - F-15: an upload with a disallowed content type is refused (415); an oversized
//          upload is refused (413); a per-role daily quota returns 429 when exceeded.

const bcrypt = require("bcrypt");
process.env.JWT_SECRET = "test-jwt-secret-at-least-32-chars-long!!";
process.env.NGO_PW_HASH = bcrypt.hashSync("n", 4);
process.env.MAX_UPLOADS_PER_DAY = "2"; // small cap so the quota test is cheap

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { createApp } = require("../app");
const { sha256Hex } = require("../lib/documents");

// In-memory store with the F-15 quota hooks, so the whole upload path is exercised
// without Postgres. put() also lets us inject a stored file directly (to test the
// download hardening on content types that upload would now refuse).
function memStore() {
  const m = new Map();
  const uploads = [];
  const norm = (h) => String(h).toLowerCase();
  return {
    configured: true,
    hashOnly: (buf) => ({ hash: sha256Hex(buf), size: buf.length }),
    async put(buf, meta = {}) {
      const hash = sha256Hex(buf);
      const existed = m.has(hash);
      if (!existed) m.set(hash, { content: buf, contentType: meta.contentType || null, filename: meta.filename || null, size: buf.length });
      return { hash, size: buf.length, contentType: meta.contentType || null, filename: meta.filename || null, existed };
    },
    async get(hash) { const d = m.get(norm(hash)); return d ? { hash: norm(hash), ...d } : null; },
    async meta(hash) { const d = m.get(norm(hash)); return d ? { stored: true, hash: norm(hash), ...d } : { stored: false }; },
    async verify() { return { stored: false, match: false }; },
    async dailyUploadUsage(role) {
      const mine = uploads.filter((u) => u.role === role);
      return { count: mine.length, bytes: mine.reduce((s, u) => s + u.size, 0) };
    },
    async recordUpload(role, size) { uploads.push({ role, size }); },
  };
}

const fakeChain = { async health() { return { ok: true }; } };
let server, base, tok, store;

before(async () => {
  store = memStore();
  const { app } = createApp({ chain: fakeChain, docs: store });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  tok = (await (await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "ngo", password: "n" }),
  })).json()).token;
});
after(() => new Promise((r) => server.close(r)));

function upload(body, contentType, filename = "f") {
  return fetch(`${base}/api/documents/upload?filename=${filename}`, {
    method: "POST",
    headers: { authorization: `Bearer ${tok}`, "content-type": contentType },
    body,
  });
}

// --- F-06: stored HTML downloads as a harmless attachment -----------------------
test("a stored text/html file is served as an octet-stream attachment with nosniff", async () => {
  // Inject it directly (upload would now refuse text/html — that's F-15, below).
  const html = Buffer.from("<script>alert(document.cookie)</script>");
  const { hash } = await store.put(html, { contentType: "text/html", filename: "evil.html" });

  const res = await fetch(`${base}/api/documents/${hash}`, { headers: { authorization: `Bearer ${tok}` } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("content-disposition") || "", /^attachment/i);
  // NOT text/html — degraded so the browser can't render/run it.
  assert.equal(res.headers.get("content-type"), "application/octet-stream");
  assert.equal(await res.text(), "<script>alert(document.cookie)</script>");
});

test("an allowed type (application/pdf) keeps its content-type but is still an attachment", async () => {
  const pdf = Buffer.from("%PDF-1.4 minimal");
  const { hash } = await store.put(pdf, { contentType: "application/pdf", filename: "ok.pdf" });
  const res = await fetch(`${base}/api/documents/${hash}`, { headers: { authorization: `Bearer ${tok}` } });
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.match(res.headers.get("content-disposition") || "", /^attachment/i);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

// --- F-07: token in the query string is rejected -------------------------------
test("a token only in the ?token= query string is rejected (401)", async () => {
  const res = await fetch(`${base}/api/documents/0x${"ab".repeat(32)}?token=${encodeURIComponent(tok)}`);
  assert.equal(res.status, 401);
});

// --- F-15: upload restrictions -------------------------------------------------
test("uploading a disallowed content type (text/html) is refused (415)", async () => {
  const res = await upload(Buffer.from("<h1>hi</h1>"), "text/html", "x.html");
  assert.equal(res.status, 415);
});

test("an oversized upload (> 8mb) is refused (413)", async () => {
  const big = Buffer.alloc(9 * 1024 * 1024, 0x41); // 9 MB of 'A'
  const res = await upload(big, "application/pdf", "big.pdf");
  assert.equal(res.status, 413);
});

test("the per-role daily upload quota returns 429 once exceeded", async () => {
  // Cap is 2/day (set above). Two distinct allowed files succeed; the third is 429.
  const a = await upload(Buffer.from("pdf-a"), "application/pdf", "a.pdf");
  const b = await upload(Buffer.from("pdf-b"), "application/pdf", "b.pdf");
  const c = await upload(Buffer.from("pdf-c"), "application/pdf", "c.pdf");
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(c.status, 429);
  assert.match((await c.json()).error, /daily upload limit/i);
});
