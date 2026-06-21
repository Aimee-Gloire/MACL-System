"use strict";
// S6 / F-09: the login endpoint is rate-limited per IP+username. Isolated in its
// own file so the limiter's per-process counter doesn't affect other suites.

const bcrypt = require("bcrypt");
process.env.JWT_SECRET = "test-jwt-secret-at-least-32-chars-long!!";
process.env.DONOR_PW_HASH = bcrypt.hashSync("d", 4);
process.env.LOGIN_RATE_MAX = "3"; // small cap so the test is cheap

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { createApp } = require("../app");

const fakeChain = { async health() { return { ok: true }; } };
let server, base;

before(async () => {
  const { app } = createApp({ chain: fakeChain });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

async function login(username, password) {
  const res = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return res.status;
}

test("login is rate-limited after the configured number of attempts (429)", async () => {
  // Cap is 3: the first three wrong attempts reach auth (401), then 429.
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push(await login("donor", "wrong"));
  assert.deepEqual(statuses.slice(0, 3), [401, 401, 401]);
  assert.equal(statuses[3], 429);
  assert.equal(statuses[4], 429);
});

test("the limiter is keyed per username — a different account still reaches auth", async () => {
  // donor is now blocked, but a different username is a different key, so it
  // reaches the auth check (401, not 429).
  assert.equal(await login("ngo", "whatever"), 401);
});
