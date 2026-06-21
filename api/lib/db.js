"use strict";
// PostgreSQL (Neon) connection for the document store. Returns null when no
// DATABASE_URL is set, so the API still runs (the document endpoints then 503).

const { Pool } = require("pg");

// Neon and other managed Postgres require TLS; local Postgres usually doesn't.
// Heuristic: SSL on unless the host is localhost — overridable via DOCSTORE_SSL.
function sslFor(url) {
  const override = (process.env.DOCSTORE_SSL || "").toLowerCase();
  if (override === "require") return { rejectUnauthorized: false };
  if (override === "disable") return false;
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  return isLocal ? false : { rejectUnauthorized: false };
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
