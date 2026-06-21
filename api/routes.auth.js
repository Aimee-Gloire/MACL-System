"use strict";
// Auth routes (BL-13): POST /api/auth/login (public) and GET /api/auth/me.
// Login returns a JWT carrying the org's role; the dashboard stores it and sends
// it on every request. No private keys are involved — the API maps role → its
// server-side signing key when it actually transacts.

const express = require("express");
const rateLimit = require("express-rate-limit");
const { ApiError } = require("./lib/chain");
const { checkCredentials, signToken, required, revokeToken } = require("./lib/auth");

// S6 / F-09: throttle login brute-force. Keyed by IP + submitted username, so a
// few wrong guesses per account per window are allowed, then a clean 429.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}|${(req.body && req.body.username) || ""}`,
  handler: (_req, res) => res.status(429).json({ error: "too many login attempts — please wait a few minutes and try again" }),
});

function makeAuthRouter() {
  const r = express.Router();
  const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // Public: exchange org credentials for a session token (rate-limited).
  r.post("/login", loginLimiter, h(async (req, res) => {
    const { username, password } = req.body || {};
    const role = await checkCredentials(username, password);
    if (!role) throw new ApiError(401, "invalid username or password");
    res.json({ token: signToken(role), role });
  }));

  // Log out: revoke THIS token server-side so it can't be reused (F-08).
  r.post("/logout", required, h(async (req, res) => {
    revokeToken(req.auth);
    res.json({ ok: true });
  }));

  // Who am I (verifies the token).
  r.get("/me", required, h(async (req, res) => res.json({ role: req.auth.role })));

  return r;
}

module.exports = { makeAuthRouter };
