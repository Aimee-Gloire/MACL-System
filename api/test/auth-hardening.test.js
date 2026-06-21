"use strict";
// S1 authentication-hardening tests.
//  - F-01: the JWT secret is fail-closed (no insecure default). The app refuses to
//    boot when JWT_SECRET is unset or shorter than 32 chars, and a token forged
//    with the OLD hard-coded default secret is rejected.
//  - F-03: passwords are bcrypt hashes. Login succeeds against a known hash with the
//    right password and fails with a wrong one; a role with no hash cannot log in.
//
// lib/auth and app read env lazily (at call time), so toggling process.env between
// tests is enough. node --test runs this file in its own process, so these env
// changes don't leak into the other test files.

const { test } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const { createApp } = require("../app");
const { authConfig, checkCredentials } = require("../lib/auth");

const VALID_SECRET = "test-jwt-secret-at-least-32-chars-long!!"; // >= 32 chars
const OLD_DEFAULT_SECRET = "dev-only-macl-secret-change-me";     // the removed default

// A fake chain so we never need Besu; the auth gate answers before it is reached.
const fakeChain = {
  async health() { return { ok: true }; },
  async getAgreements() { return []; },
};

// Spin up the app on an ephemeral port, run fn(base), always close the socket.
async function withServer(fn) {
  const { app } = createApp({ chain: fakeChain });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); } finally { await new Promise((r) => server.close(r)); }
}

async function login(base, username, password) {
  const res = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// --- F-01: fail-closed JWT secret ---------------------------------------------

test("authConfig throws when JWT_SECRET is unset (fail-closed)", () => {
  delete process.env.JWT_SECRET;
  assert.throws(() => authConfig(), /JWT_SECRET/);
});

test("the app refuses to boot when JWT_SECRET is unset", () => {
  delete process.env.JWT_SECRET;
  assert.throws(() => createApp({ chain: fakeChain }), /JWT_SECRET/);
});

test("the app refuses to boot when JWT_SECRET is too short (< 32 chars)", () => {
  process.env.JWT_SECRET = "too-short-secret"; // 16 chars
  assert.throws(() => createApp({ chain: fakeChain }), /JWT_SECRET/);
});

test("a token forged with the OLD default secret is rejected (401)", async () => {
  process.env.JWT_SECRET = VALID_SECRET;
  process.env.DONOR_PW_HASH = bcrypt.hashSync("x", 4);
  const forged = jwt.sign({ role: "donor" }, OLD_DEFAULT_SECRET, { expiresIn: "1h" });
  await withServer(async (base) => {
    const res = await fetch(base + "/api/agreements", {
      headers: { authorization: `Bearer ${forged}` },
    });
    assert.equal(res.status, 401);
  });
});

// --- F-03: bcrypt-hashed passwords --------------------------------------------

test("login succeeds with the correct password against a known bcrypt hash", async () => {
  process.env.JWT_SECRET = VALID_SECRET;
  process.env.DONOR_PW_HASH = bcrypt.hashSync("correct-horse", 4);
  await withServer(async (base) => {
    const r = await login(base, "donor", "correct-horse");
    assert.equal(r.status, 200);
    assert.equal(r.json.role, "donor");
    assert.ok(typeof r.json.token === "string" && r.json.token.length > 20);
  });
});

test("login fails with a wrong password (401)", async () => {
  process.env.JWT_SECRET = VALID_SECRET;
  process.env.DONOR_PW_HASH = bcrypt.hashSync("correct-horse", 4);
  await withServer(async (base) => {
    const r = await login(base, "donor", "wrong-password");
    assert.equal(r.status, 401);
  });
});

test("checkCredentials: matches a hash, rejects wrong pw, and a role with no hash cannot log in", async () => {
  process.env.JWT_SECRET = VALID_SECRET;
  process.env.DONOR_PW_HASH = bcrypt.hashSync("pw", 4);
  delete process.env.NGO_PW_HASH; // no hash configured for ngo
  assert.equal(await checkCredentials("donor", "pw"), "donor");
  assert.equal(await checkCredentials("donor", "nope"), null);
  assert.equal(await checkCredentials("ngo", "anything"), null);
});
