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

const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { ApiError } = require("./chain");

// S6 / F-08: server-side revocation. Each token carries a unique id (jti); logout
// adds that id to this deny-list so the exact token can no longer be used, even
// though it hasn't expired. Entries auto-clear when the token would have expired
// anyway, so the list stays small. (In-memory: a process restart clears it, which
// only ever ERRS ON THE SAFE SIDE for a short-lived token — fine at capstone scale;
// a multi-instance deployment would back this with Redis/Postgres.)
const revokedJtis = new Map(); // jti -> exp (unix seconds)

// The three on-chain organisations (each has a server-side signing key).
const ORG_ROLES = ["donor", "ngo", "audit"];
// All valid LOGIN identities. "admin" (S3 / F-04) is a login-only identity used to
// gate the owner-key action (registering organisations). It has NO org signing key
// and therefore NO donor/ngo/audit on-chain powers — see lib/config.js roleKeyEnv.
const ROLES = [...ORG_ROLES, "admin"];

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
    // S6 / F-08: short sessions by default (was 12h). Override with JWT_TTL.
    ttl: process.env.JWT_TTL || "1h",
    // role -> bcrypt hash of that role's password (from env). Missing = "" = the
    // role cannot log in. Covers every login role, including admin (ADMIN_PW_HASH).
    passwordHashes: Object.fromEntries(ROLES.map((role) => [role, process.env[pwHashEnvName(role)] || ""])),
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
  // jwtid (jti) gives every token a unique id so it can be revoked individually.
  return jwt.sign({ role }, secret, { expiresIn: ttl, jwtid: crypto.randomUUID() });
}

function verifyToken(token) {
  const { secret } = authConfig();
  return jwt.verify(token, secret); // throws on invalid/expired
}

// S6 / F-08: revoke a single token (by its decoded payload) — used by logout.
function revokeToken(payload) {
  if (!payload || !payload.jti) return;
  revokedJtis.set(payload.jti, payload.exp || 0);
  // Drop the entry automatically once the token would have expired anyway.
  const ms = (payload.exp || 0) * 1000 - Date.now();
  if (ms > 0) { const t = setTimeout(() => revokedJtis.delete(payload.jti), ms); if (t.unref) t.unref(); }
  else revokedJtis.delete(payload.jti);
}
function isRevoked(jti) {
  return jti != null && revokedJtis.has(jti);
}

// Pull a token from the Authorization header ONLY. S5 / F-07: the previous
// ?token= query-param fallback is gone — tokens in URLs leak into logs, history
// and referrers. Document downloads now fetch() with the header and save a Blob
// (see dashboard chain.js/ui.js), so no link needs to carry the token any more.
function tokenFromReq(req) {
  const hdr = req.get("authorization") || "";
  const m = hdr.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1];
  return null;
}

// Express middleware: require a valid, non-revoked token; set req.auth.
function required(req, res, next) {
  const token = tokenFromReq(req);
  if (!token) return next(new ApiError(401, "authentication required"));
  try {
    const payload = verifyToken(token);          // throws on bad/expired token
    if (!ROLES.includes(payload.role)) throw new Error("bad role");
    if (isRevoked(payload.jti)) throw new Error("revoked");  // F-08: logged out
    // carry jti + exp so logout can revoke exactly this token.
    req.auth = { role: payload.role, jti: payload.jti, exp: payload.exp };
    next();
  } catch (_) {
    next(new ApiError(401, "invalid or expired token"));
  }
}

module.exports = { ROLES, MIN_SECRET_LENGTH, authConfig, rolesWithoutPasswordHash, checkCredentials, signToken, verifyToken, revokeToken, required };
