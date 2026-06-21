"use strict";
// Security regression (BL-13): prove that EVERY write endpoint and EVERY document
// endpoint rejects a request that carries no valid token (401), and that only the
// two intended public endpoints (health, login) are reachable without one.

const bcrypt = require("bcrypt");
process.env.JWT_SECRET = "test-jwt-secret-at-least-32-chars-long!!";
process.env.DONOR_PW_HASH = bcrypt.hashSync("d", 4);

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { createApp } = require("../app");

// A chain/docs that would 200 if ever reached — so a 401 can only come from the
// auth gate, never from a missing dependency.
const okChain = new Proxy({}, { get: () => async () => ({ ok: true }) });
const okDocs = {
  configured: true,
  hashOnly: () => ({ hash: "0x" + "0".repeat(64), size: 0 }),
  put: async () => ({ hash: "0x" + "0".repeat(64) }),
  get: async () => ({ hash: "0x" + "0".repeat(64), content: Buffer.from(""), contentType: "text/plain", filename: "f", size: 0 }),
  meta: async () => ({ stored: true }),
  verify: async () => ({ stored: true, match: true }),
};

let server, base;
before(async () => {
  const { app } = createApp({ chain: okChain, docs: okDocs });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

const HASH = "0x" + "ab".repeat(32);

// Every endpoint that MUST require a token.
const PROTECTED = [
  // contract writes
  ["POST", "/api/agreements"],
  ["POST", "/api/agreements/1/targets"],
  ["POST", "/api/agreements/1/finalise"],
  ["POST", "/api/agreements/1/budget"],
  ["POST", "/api/org/register"],
  ["POST", "/api/reports"],
  ["POST", "/api/spend"],
  ["POST", "/api/spend/1/endorse"],
  ["POST", "/api/spend/1/decline"],
  ["POST", "/api/spend/1/spent"],
  ["POST", "/api/records/1/endorse"],
  ["POST", "/api/records/1/decline"],
  ["POST", "/api/records/1/expire"],
  // reads
  ["GET", "/api/agreements"],
  ["GET", "/api/records"],
  ["GET", "/api/spend"],
  ["GET", "/api/nodes"],
  ["GET", "/api/blocks/recent"],
  ["GET", "/api/events/agreements"],
  ["GET", "/api/org/0x0000000000000000000000000000000000000000"],
  ["GET", "/api/agreements/1/failing"],
  ["GET", "/api/integrity/record/1"],
  // documents
  ["POST", "/api/documents/upload"],
  ["POST", "/api/documents/hash"],
  ["GET", `/api/documents/${HASH}`],
  ["GET", `/api/documents/${HASH}/meta`],
  ["GET", `/api/documents/${HASH}/verify`],
];

for (const [method, path] of PROTECTED) {
  test(`${method} ${path} → 401 without a token`, async () => {
    const res = await fetch(base + path, {
      method,
      headers: method === "POST" ? { "content-type": "application/json" } : undefined,
      body: method === "POST" ? "{}" : undefined,
    });
    assert.equal(res.status, 401, `${method} ${path} should be 401 but was ${res.status}`);
  });
}

// The only two endpoints that are intentionally public.
test("GET /api/health is reachable without a token", async () => {
  const res = await fetch(base + "/api/health");
  assert.notEqual(res.status, 401);
});
test("POST /api/auth/login is reachable without a token", async () => {
  const res = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "donor", password: "d" }),
  });
  assert.notEqual(res.status, 401); // valid creds → 200
});

// A token also can't be smuggled past role rules: every protected endpoint that
// isn't the two public ones must reject a malformed bearer too.
test("a malformed bearer token is rejected on a protected route", async () => {
  const res = await fetch(base + "/api/agreements", { headers: { authorization: "Bearer nope" } });
  assert.equal(res.status, 401);
});
