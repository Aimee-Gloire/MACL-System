"use strict";
// BL-12 document-store endpoint tests. Use an in-memory store built on the REAL
// server-side hasher (sha256Hex), so routing + hashing + verify are exercised
// without needing Postgres. Routes require a session token (BL-13), so we log in.

const bcrypt = require("bcrypt");
process.env.JWT_SECRET = "test-jwt-secret-at-least-32-chars-long!!";
process.env.DONOR_PW_HASH = bcrypt.hashSync("d", 4);
process.env.NGO_PW_HASH = bcrypt.hashSync("n", 4);
process.env.AUDIT_PW_HASH = bcrypt.hashSync("a", 4);

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { createApp } = require("../app");
const { sha256Hex, makeUnconfiguredStore, makeDocStore } = require("../lib/documents");

// SHA-256("hello") — fixed known value, lets us assert the server hash exactly.
const HELLO_HASH = "0x2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

function memStore() {
  const m = new Map();
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
    async meta(hash) { const d = m.get(norm(hash)); return d ? { stored: true, hash: norm(hash), contentType: d.contentType, filename: d.filename, size: d.size } : { stored: false }; },
    async verify(hash) {
      const d = m.get(norm(hash));
      if (!d) return { stored: false, match: false, computedHash: null, size: 0 };
      const c = sha256Hex(d.content);
      return { stored: true, match: c === norm(hash), computedHash: c, size: d.size };
    },
  };
}

const fakeChain = { async health() { return { ok: true }; } };
let server, base, tok;

before(async () => {
  const { app } = createApp({ chain: fakeChain, docs: memStore() });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  tok = (await (await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "ngo", password: "n" }),
  })).json()).token;
});
after(() => new Promise((r) => server.close(r)));

async function raw(method, path, body, contentType) {
  const headers = { authorization: `Bearer ${tok}` };
  if (body != null) headers["content-type"] = contentType || "text/plain";
  const res = await fetch(base + path, { method, headers, body });
  return res;
}

test("sha256Hex matches the known SHA-256 of 'hello'", () => {
  assert.equal(sha256Hex(Buffer.from("hello")), HELLO_HASH);
});

test("upload stores a file and returns its server-computed hash", async () => {
  const res = await raw("POST", "/api/documents/upload?filename=note.txt", "hello");
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.hash, HELLO_HASH);
  assert.equal(j.size, 5);
  assert.equal(j.existed, false);
});

test("re-uploading identical bytes is idempotent (existed=true)", async () => {
  const res = await raw("POST", "/api/documents/upload", "hello");
  const j = await res.json();
  assert.equal(j.hash, HELLO_HASH);
  assert.equal(j.existed, true);
});

test("download returns the stored bytes", async () => {
  const res = await raw("GET", `/api/documents/${HELLO_HASH}`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "hello");
});

test("verify confirms the stored file matches the on-chain hash", async () => {
  const res = await raw("GET", `/api/documents/${HELLO_HASH}/verify`);
  const j = await res.json();
  assert.equal(j.stored, true);
  assert.equal(j.match, true);
});

test("verify reports not-stored for an unknown (well-formed) hash", async () => {
  const unknown = "0x" + "ab".repeat(32);
  const res = await raw("GET", `/api/documents/${unknown}/verify`);
  const j = await res.json();
  assert.equal(j.stored, false);
  assert.equal(j.match, false);
});

test("a malformed hash is rejected with 400", async () => {
  const res = await raw("GET", "/api/documents/not-a-hash/verify");
  assert.equal(res.status, 400);
});

test("hash-only computes without storing", async () => {
  const res = await raw("POST", "/api/documents/hash", "world");
  const j = await res.json();
  assert.equal(j.hash, sha256Hex(Buffer.from("world")));
  // not stored:
  const meta = await (await raw("GET", `/api/documents/${j.hash}/meta`)).json();
  assert.equal(meta.stored, false);
});

test("download 404s when nothing is stored for the hash", async () => {
  const unknown = "0x" + "cd".repeat(32);
  const res = await raw("GET", `/api/documents/${unknown}`);
  assert.equal(res.status, 404);
});

test("document routes require a token (401 without one)", async () => {
  const res = await fetch(base + "/api/documents/upload", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });
  assert.equal(res.status, 401);
});

test("empty upload body is rejected with 400", async () => {
  const res = await fetch(base + "/api/documents/upload", { method: "POST", headers: { "content-type": "text/plain", authorization: `Bearer ${tok}` }, body: "" });
  assert.equal(res.status, 400);
});

test("store.verify detects a TAMPERED stored file (match=false) — BL-14", async () => {
  // Real pg-backed store over a fake pool that returns bytes which do NOT hash to
  // the requested key. This is the only way the verify "✗ not verified" path can
  // arise (the bytes were altered out-of-band in the DB).
  const tamperedPool = {
    async query() {
      return {
        rows: [{
          hash: HELLO_HASH, content: Buffer.from("tampered-bytes"),
          content_type: "text/plain", filename: "f.txt", size_bytes: 14, uploaded_at: new Date(0),
        }],
        rowCount: 1,
      };
    },
  };
  const store = makeDocStore(tamperedPool);
  const v = await store.verify(HELLO_HASH);
  assert.equal(v.stored, true);
  assert.equal(v.match, false);
  assert.notEqual(v.computedHash, HELLO_HASH);
});

test("endpoints 503 when the document store is not configured", async () => {
  const { app } = createApp({ chain: fakeChain, docs: makeUnconfiguredStore() });
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  const res = await fetch(b + "/api/documents/upload", { method: "POST", headers: { "content-type": "text/plain", authorization: `Bearer ${tok}` }, body: "x" });
  assert.equal(res.status, 503);
  await new Promise((r) => srv.close(r));
});
