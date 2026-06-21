"use strict";
// S3 / F-04 tests: the owner-key action POST /api/org/register is admin-only.
//  - donor / ngo / audit tokens are rejected with a clean 403;
//  - an admin token succeeds and reaches the chain layer;
//  - a role supplied in the BODY is ignored — only the token's role decides.

const bcrypt = require("bcrypt");
process.env.JWT_SECRET = "test-jwt-secret-at-least-32-chars-long!!";
process.env.DONOR_PW_HASH = bcrypt.hashSync("d", 4);
process.env.NGO_PW_HASH = bcrypt.hashSync("n", 4);
process.env.AUDIT_PW_HASH = bcrypt.hashSync("a", 4);
process.env.ADMIN_PW_HASH = bcrypt.hashSync("adm", 4);

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { createApp } = require("../app");

const calls = [];
const fakeChain = {
  async health() { return { ok: true }; },
  async getAgreements() { return []; },
  async registerOrg(address, orgType, name) {
    calls.push({ address, orgType, name });
    return { hash: "0xreg", blockNumber: 5 };
  },
};

let server, base;
async function login(username, password) {
  const res = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return (await res.json().catch(() => ({}))).token;
}
async function register(token, body) {
  const res = await fetch(base + "/api/org/register", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const ORG = { address: "0x1111111111111111111111111111111111111111", orgType: "1", name: "Donor Org" };

before(async () => {
  const { app } = createApp({ chain: fakeChain });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

for (const role of ["donor", "ngo", "audit"]) {
  test(`${role} token is forbidden from org/register (403)`, async () => {
    const token = await login(role, role === "donor" ? "d" : role === "ngo" ? "n" : "a");
    const r = await register(token, ORG);
    assert.equal(r.status, 403);
    assert.match(r.json.error, /requires admin/i);
    assert.equal(calls.length, 0, "chain.registerOrg must not be called for a non-admin");
  });
}

test("admin token may register an organisation (200, reaches the chain)", async () => {
  const token = await login("admin", "adm");
  const r = await register(token, ORG);
  assert.equal(r.status, 200);
  assert.equal(r.json.hash, "0xreg");
  assert.equal(calls.at(-1).address, ORG.address);
});

test("a body-supplied role cannot elevate a donor to admin (still 403)", async () => {
  const before = calls.length;
  const token = await login("donor", "d");
  // The request body claims to be admin — it must be ignored; the token says donor.
  const r = await register(token, { ...ORG, role: "admin" });
  assert.equal(r.status, 403);
  assert.equal(calls.length, before, "no registration should have happened");
});
