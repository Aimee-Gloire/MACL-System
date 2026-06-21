"use strict";
// BL-13 authentication: per-org login → JWT. The token carries the org's ROLE;
// every protected route derives the acting role from the token (never from the
// request body), so a session can only ever act as the org it logged in as.
//
// Security hardening (S1):
//  - F-01: the JWT secret is FAIL-CLOSED. There is no hard-coded default any more;
//    authConfig() throws a clear startup error if JWT_SECRET is missing or shorter
//    than 32 characters, so the API refuses to boot/sign tokens on an insecure key.
//  - F-03: login passwords are no longer stored or compared in plaintext. Each org
//    has a bcrypt HASH in env (DONOR_PW_HASH / NGO_PW_HASH / AUDIT_PW_HASH) and
//    checkCredentials uses bcrypt.compare. A role with no hash simply cannot log in.

const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { ApiError } = require("./chain");

const ROLES = ["donor", "ngo", "audit"];

// Minimum acceptable length for the signing secret (F-01). 32 hex chars is the
// width of `openssl rand -hex 16`; we recommend `openssl rand -hex 32` (64 chars).
const MIN_SECRET_LENGTH = 32;

// env var name that holds the bcrypt hash for a given role.
function pwHashEnvName(role) {
  return `${role.toUpperCase()}_PW_HASH`;
}

// Read and VALIDATE the auth configuration. Throws (fail-closed) if the JWT secret
// is missing or too short, so the API cannot run on an insecure default key.
function authConfig() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET is missing or too short (need >= ${MIN_SECRET_LENGTH} characters). ` +
        `Set JWT_SECRET in api/.env to a long random string, e.g. run: openssl rand -hex 32`
    );
  }
  return {
    secret,
    ttl: process.env.JWT_TTL || "12h",
    // role -> bcrypt hash of that org's password (from env). Missing = "" = the
    // role cannot log in.
    passwordHashes: {
      donor: process.env.DONOR_PW_HASH || "",
      ngo: process.env.NGO_PW_HASH || "",
      audit: process.env.AUDIT_PW_HASH || "",
    },
  };
}

// Roles that have NO password hash configured, so they can't log in. Used by the
// boot banner to warn honestly (replaces the old usingDefaultPasswords()).
function rolesWithoutPasswordHash() {
  return ROLES.filter((role) => !process.env[pwHashEnvName(role)]);
}

// Validate username/password; resolve to the role on success, else null. The
// password is compared against the per-org bcrypt hash with bcrypt.compare — no
// plaintext password is ever stored or compared. Async because bcrypt is async.
async function checkCredentials(username, password) {
  const role = String(username || "");
  if (!ROLES.includes(role)) return null;
  if (typeof password !== "string" || password.length === 0) return null;
  const { passwordHashes } = authConfig();
  const hash = passwordHashes[role];
  if (!hash) return null; // no hash configured for this role → cannot log in
  const ok = await bcrypt.compare(password, hash);
  return ok ? role : null;
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

module.exports = { ROLES, MIN_SECRET_LENGTH, authConfig, rolesWithoutPasswordHash, checkCredentials, signToken, verifyToken, required };
