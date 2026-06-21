"use strict";
// Routing/validation tests. Protected routes now require a session token (BL-13),
// so we log in first and send the JWT. A FAKE chain keeps these fast (no Besu).

// Test auth config (read lazily by lib/auth, so setting it here is enough).
process.env.JWT_SECRET = "test-secret";
process.env.DONOR_PASSWORD = "d";
process.env.NGO_PASSWORD = "n";
process.env.AUDIT_PASSWORD = "a";

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { createApp } = require("../app");

const calls = [];
const fakeChain = {
  async health() { return { ok: true, chainId: "1337", block: 7, addresses: { Agreement: "0x1" } }; },
  async getAgreements() { return []; },
  async createAgreement(role, startDate, endDate, signatories) {
    calls.push({ role, startDate, endDate, signatories });
    return { hash: "0xabc", blockNumber: 9, id: "1" };
  },
};

let server, base, donorToken;

before(async () => {
  const { app } = createApp({ chain: fakeChain });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  donorToken = (await (await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "donor", password: "d" }),
  })).json()).token;
});
after(() => new Promise((r) => server.close(r)));

async function req(method, path, body, tok) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  if (tok) headers["authorization"] = `Bearer ${tok}`;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

test("GET /api/health is public", async () => {
  const r = await req("GET", "/api/health");
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});

test("a protected read requires a token", async () => {
  const r = await req("GET", "/api/agreements");
  assert.equal(r.status, 401);
});

test("a protected read works with a token", async () => {
  const r = await req("GET", "/api/agreements", null, donorToken);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json));
});

test("unknown route returns 404 (with a token)", async () => {
  const r = await req("GET", "/api/nope", null, donorToken);
  assert.equal(r.status, 404);
});

test("POST /api/agreements rejects missing fields", async () => {
  const r = await req("POST", "/api/agreements", { startDate: "1" }, donorToken);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /missing field/i);
});

test("POST /api/agreements rejects an empty signatories array", async () => {
  const r = await req("POST", "/api/agreements", { startDate: "1", endDate: "2", signatories: [] }, donorToken);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /signatories/i);
});

test("POST /api/agreements with a donor token reaches the chain layer", async () => {
  const r = await req("POST", "/api/agreements", { startDate: "1000", endDate: "2000", signatories: ["0xabc"] }, donorToken);
  assert.equal(r.status, 200);
  assert.equal(r.json.id, "1");
  // role came from the TOKEN, not the body:
  assert.equal(calls.at(-1).role, "donor");
});

test("POST /api/records/:id/endorse rejects a non-numeric id", async () => {
  const r = await req("POST", "/api/records/abc/endorse", {}, donorToken);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /invalid id/i);
});

test("GET /api/integrity/:kind/:id rejects an invalid kind", async () => {
  const r = await req("GET", "/api/integrity/bogus/1", null, donorToken);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /invalid kind/i);
});
