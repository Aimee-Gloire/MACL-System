"use strict";
// PostgreSQL (Neon) connection for the document store. Returns null when no
// DATABASE_URL is set, so the API still runs (the document endpoints then 503).

const fs = require("fs");
const { Pool } = require("pg");

// TLS policy (S2 / F-12). We NEVER disable certificate verification for a remote
// database. Local Postgres needs no TLS; any remote host is connected over TLS
// with the certificate VERIFIED:
//   - if PG_CA_CERT points to a CA file, we pin it (rejectUnauthorized: true + ca);
//   - otherwise we still verify against Node's built-in CA store (works for Neon,
//     whose certs chain to a public CA) and log how to pin a CA explicitly.
// DOCSTORE_SSL overrides the heuristic: "disable" = no TLS, "require" = force TLS.
function sslFor(url) {
  const override = (process.env.DOCSTORE_SSL || "").toLowerCase();
  if (override === "disable") return false;

  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  if (isLocal && override !== "require") return false; // local dev Postgres: no TLS

  // Remote (or TLS forced): verify the certificate. Pin a CA if provided.
  const caPath = process.env.PG_CA_CERT;
  if (caPath) {
    let ca;
    try {
      ca = fs.readFileSync(caPath, "utf8");
    } catch (e) {
      throw new Error(`PG_CA_CERT is set to "${caPath}" but the file could not be read: ${e.message}`);
    }
    return { rejectUnauthorized: true, ca };
  }
  console.warn(
    "WARNING: connecting to a remote Postgres over TLS without a pinned CA " +
      "(PG_CA_CERT is unset). The certificate is still verified against the system CA " +
      "store. To pin the CA, download it from your provider (e.g. the Neon console) and " +
      "set PG_CA_CERT=/path/to/ca.crt in api/.env."
  );
  return { rejectUnauthorized: true };
}

function makePool() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const ssl = sslFor(url); // decide TLS from the original URL (before we strip params)
  // We control TLS via the `ssl` option above, so drop a redundant `sslmode`
  // from the connection string — it triggers a forward-looking pg deprecation
  // warning ("require treated as verify-full") without changing behaviour here.
  let connectionString = url;
  try {
    const u = new URL(url);
    u.searchParams.delete("sslmode");
    connectionString = u.toString();
  } catch (_) { /* keep the raw URL if it isn't parseable */ }
  return new Pool({ connectionString, ssl });
}

module.exports = { makePool };
