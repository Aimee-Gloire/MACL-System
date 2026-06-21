"use strict";
// S6 tests: token revocation on logout (F-08), generic 5xx errors (F-14), and the
// structured write audit log (F-14).

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const bcrypt = require("bcrypt");

process.env.JWT_SECRET = "test-jwt-secret-at-least-32-chars-long!!";
process.env.DONOR_PW_HASH = bcrypt.hashSync("d", 4);
// Isolated audit-log file for this run.
const AUDIT = path.join(os.tmpdir(), `macl-audit-${process.pid}.log`);
process.env.AUDIT_LOG = AUDIT;

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { createApp } = require("../app");

const fakeChain = {
  async health() { return { ok: true }; },
  // Throws a plain Error → an unexpected 5xx carrying an internal-looking message.
  async getAgreements() { throw new Error("connect ECONNREFUSED super-secret-internal-detail"); },
  async createAgreement() { return { hash: "0xwritetx", blockNumber: 3, id: "7" }; },
};

let server, base;
async function login() {
  const r = await (await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "donor", password: "d" }),
  })).json();
  return r.token;
}

before(async () => {
  try { fs.unlinkSync(AUDIT); } catch (_) {}
  const { app } = createApp({ chain: fakeChain });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { fs.unlinkSync(AUDIT); } catch (_) {} return new Promise((r) => server.close(r)); });

test("logout revokes the token — it works before, is rejected after (F-08)", async () => {
  const token = await login();
  const before = await fetch(base + "/api/auth/me", { headers: { authorization: `Bearer ${token}` } });
  assert.equal(before.status, 200);

  const out = await fetch(base + "/api/auth/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } });
  assert.equal(out.status, 200);

  const after = await fetch(base + "/api/auth/me", { headers: { authorization: `Bearer ${token}` } });
  assert.equal(after.status, 401);
});

test("a 5xx returns a generic body + error id and never leaks internal text (F-14)", async () => {
  const token = await login();
  const res = await fetch(base + "/api/agreements", { headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.status, 500);
  const j = await res.json();
  assert.equal(j.error, "internal server error");
  assert.ok(typeof j.errorId === "string" && j.errorId.length > 0, "expected a short error id");
  assert.ok(!JSON.stringify(j).includes("super-secret-internal-detail"), "internal detail must not leak");
});

test("a successful write produces a structured audit-log entry (F-14)", async () => {
  const token = await login();
  const res = await fetch(base + "/api/agreements", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ startDate: "1", endDate: "2", signatories: ["0xabc"] }),
  });
  assert.equal(res.status, 200);

  const entries = fs.readFileSync(AUDIT, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const entry = entries.find((e) => e.action === "POST /agreements" && e.tx === "0xwritetx");
  assert.ok(entry, "expected an audit entry for the write");
  assert.equal(entry.role, "donor");
  assert.ok(entry.at, "entry should carry a timestamp");
});
