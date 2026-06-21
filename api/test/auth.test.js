"use strict";
// BL-13 auth tests: login, token gating, role-from-token enforcement (403),
// the public health exception, and the ?token= query fallback (download links).

const bcrypt = require("bcrypt");
process.env.JWT_SECRET = "test-jwt-secret-at-least-32-chars-long!!";
process.env.DONOR_PW_HASH = bcrypt.hashSync("d", 4);
process.env.NGO_PW_HASH = bcrypt.hashSync("n", 4);
process.env.AUDIT_PW_HASH = bcrypt.hashSync("a", 4);

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { createApp } = require("../app");

const fakeChain = {
  async health() { return { ok: true }; },
  async getAgreements() { return [{ id: "1" }]; },
  // submitReport should never be reached by a donor (403 first); guard anyway.
  async submitReport() { return { hash: "0x0", blockNumber: 1, recordId: "1", result: 1 }; },
};

let server, base;
async function login(username, password) {
  const res = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

before(async () => {
  const { app } = createApp({ chain: fakeChain });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

test("login with bad credentials → 401", async () => {
  const r = await login("donor", "wrong");
  assert.equal(r.status, 401);
});

test("login with good credentials → token + role", async () => {
  const r = await login("ngo", "n");
  assert.equal(r.status, 200);
  assert.equal(r.json.role, "ngo");
  assert.ok(typeof r.json.token === "string" && r.json.token.length > 20);
});

test("a protected route is 401 without a token", async () => {
  const res = await fetch(base + "/api/agreements");
  assert.equal(res.status, 401);
});

test("role is taken from the token: donor may not submit a report (403)", async () => {
  const { json } = await login("donor", "d");
  const res = await fetch(base + "/api/reports", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${json.token}` },
    body: JSON.stringify({ agreementId: "1", targetIndex: "0", value: "100" }),
  });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /requires ngo/i);
});

test("a token in the ?token= query string is REJECTED (F-07: header-only auth)", async () => {
  const { json } = await login("audit", "a");
  // Same valid token, but only in the URL — no Authorization header.
  const res = await fetch(`${base}/api/agreements?token=${encodeURIComponent(json.token)}`);
  assert.equal(res.status, 401);
  // And it works when the same token is sent as a header.
  const ok = await fetch(`${base}/api/agreements`, { headers: { authorization: `Bearer ${json.token}` } });
  assert.equal(ok.status, 200);
});

test("a garbage token → 401", async () => {
  const res = await fetch(base + "/api/agreements", { headers: { authorization: "Bearer not.a.jwt" } });
  assert.equal(res.status, 401);
});
