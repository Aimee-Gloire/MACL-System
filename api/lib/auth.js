"use strict";
// BL-13 authentication: per-org login → JWT. The token carries the org's ROLE;
// every protected route derives the acting role from the token (never from the
// request body), so a session can only ever act as the org it logged in as.

const jwt = require("jsonwebtoken");
const { ApiError } = require("./chain");

const ROLES = ["donor", "ngo", "audit"];

function authConfig() {
  return {
    secret: process.env.JWT_SECRET || "dev-only-macl-secret-change-me",
    ttl: process.env.JWT_TTL || "12h",
    // username (= role name) -> password, from env (TEST credentials by default).
    passwords: {
      donor: process.env.DONOR_PASSWORD || "donor123",
      ngo: process.env.NGO_PASSWORD || "ngo123",
      audit: process.env.AUDIT_PASSWORD || "audit123",
    },
  };
}

function usingDefaultSecret() {
  return !process.env.JWT_SECRET;
}

// True if ANY org login password is unset (i.e. falling back to a TEST default).
function usingDefaultPasswords() {
  return !process.env.DONOR_PASSWORD || !process.env.NGO_PASSWORD || !process.env.AUDIT_PASSWORD;
}

// Validate username/password; return the role on success, else null.
function checkCredentials(username, password) {
  const { passwords } = authConfig();
  const role = String(username || "");
  if (!ROLES.includes(role)) return null;
  if (typeof password !== "string" || password.length === 0) return null;
  // Constant-ish comparison is overkill for a capstone test credential, but the
  // exact-match check below is the gate.
  return passwords[role] === password ? role : null;
}

function signToken(role) {
  const { secret, ttl } = authConfig();
  return jwt.sign({ role }, secret, { expiresIn: ttl });
}

function verifyToken(token) {
  const { secret } = authConfig();
  return jwt.verify(token, secret); // throws on invalid/expired
}

// Pull a token from the Authorization header OR a ?token= query param. The query
// fallback is what lets plain <a href> document downloads (which can't set a
// header) carry the session — fine for the capstone's localhost/LAN scope.
function tokenFromReq(req) {
  const hdr = req.get("authorization") || "";
  const m = hdr.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1];
  if (req.query && req.query.token) return String(req.query.token);
  return null;
}

// Express middleware: require a valid token; set req.auth = { role }.
function required(req, res, next) {
  const token = tokenFromReq(req);
  if (!token) return next(new ApiError(401, "authentication required"));
  try {
    const payload = verifyToken(token);
    if (!ROLES.includes(payload.role)) throw new Error("bad role");
    req.auth = { role: payload.role };
    next();
  } catch (_) {
    next(new ApiError(401, "invalid or expired token"));
  }
}

module.exports = { ROLES, authConfig, usingDefaultSecret, usingDefaultPasswords, checkCredentials, signToken, verifyToken, required };
