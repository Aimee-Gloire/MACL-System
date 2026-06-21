"use strict";
// Auth routes (BL-13): POST /api/auth/login (public) and GET /api/auth/me.
// Login returns a JWT carrying the org's role; the dashboard stores it and sends
// it on every request. No private keys are involved — the API maps role → its
// server-side signing key when it actually transacts.

const express = require("express");
const { ApiError } = require("./lib/chain");
const { checkCredentials, signToken, required } = require("./lib/auth");

function makeAuthRouter() {
  const r = express.Router();
  const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // Public: exchange org credentials for a session token.
  r.post("/login", h(async (req, res) => {
    const { username, password } = req.body || {};
    const role = await checkCredentials(username, password);
    if (!role) throw new ApiError(401, "invalid username or password");
    res.json({ token: signToken(role), role });
  }));

  // Who am I (verifies the token).
  r.get("/me", required, h(async (req, res) => res.json({ role: req.auth.role })));

  return r;
}

module.exports = { makeAuthRouter };
