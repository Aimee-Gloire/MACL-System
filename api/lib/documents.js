"use strict";
// BL-12 document store. Computes the SHA-256 SERVER-SIDE (no dependency on the
// browser's crypto.subtle, which is unavailable over plain http on a real domain)
// and stores/reads the bytes in Postgres, keyed by that hash.

const crypto = require("node:crypto");
const { ApiError } = require("./chain");

// 0x-prefixed lowercase SHA-256 — identical shape to the bytes32 stored on-chain.
function sha256Hex(buffer) {
  return "0x" + crypto.createHash("sha256").update(buffer).digest("hex");
}

function normHash(h) {
  return String(h || "").toLowerCase();
}

// Real Postgres-backed store.
function makeDocStore(pool) {
  return {
    configured: true,

    // Compute the hash WITHOUT storing (used by "verify a candidate file").
    hashOnly(buffer) {
      return { hash: sha256Hex(buffer), size: buffer.length };
    },

    // Store the file under its own hash (idempotent: same bytes => same row).
    async put(buffer, { contentType, filename } = {}) {
      const hash = sha256Hex(buffer);
      const res = await pool.query(
        `INSERT INTO documents (hash, content, content_type, filename, size_bytes)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (hash) DO NOTHING
         RETURNING hash`,
        [hash, buffer, contentType || null, filename || null, buffer.length]
      );
      return { hash, size: buffer.length, contentType: contentType || null, filename: filename || null, existed: res.rowCount === 0 };
    },

    // Fetch the stored file (bytes + metadata) or null.
    async get(hash) {
      const { rows } = await pool.query(
        "SELECT hash, content, content_type, filename, size_bytes, uploaded_at FROM documents WHERE hash = $1",
        [normHash(hash)]
      );
      if (!rows.length) return null;
      const r = rows[0];
      return {
        hash: r.hash,
        content: r.content, // Buffer
        contentType: r.content_type,
        filename: r.filename,
        size: Number(r.size_bytes),
        uploadedAt: r.uploaded_at,
      };
    },

    // Metadata only (no bytes).
    async meta(hash) {
      const { rows } = await pool.query(
        "SELECT hash, content_type, filename, size_bytes, uploaded_at FROM documents WHERE hash = $1",
        [normHash(hash)]
      );
      if (!rows.length) return { stored: false };
      const r = rows[0];
      return { stored: true, hash: r.hash, contentType: r.content_type, filename: r.filename, size: Number(r.size_bytes), uploadedAt: r.uploaded_at };
    },

    // Re-hash the STORED bytes and compare to the given (on-chain) hash. A match
    // proves the stored file is unchanged since it was recorded on the ledger.
    async verify(hash) {
      const doc = await this.get(hash);
      if (!doc) return { stored: false, match: false, computedHash: null, size: 0 };
      const computedHash = sha256Hex(doc.content);
      return { stored: true, match: computedHash === normHash(hash), computedHash, size: doc.size };
    },

    // F-15 quota helpers: how much this role has uploaded so far TODAY, and an
    // append-only record of each upload (used to enforce the per-day cap).
    async dailyUploadUsage(role) {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(size_bytes), 0)::bigint AS bytes
           FROM upload_log WHERE role = $1 AND uploaded_at >= date_trunc('day', now())`,
        [role]
      );
      return { count: rows[0].count, bytes: Number(rows[0].bytes) };
    },
    async recordUpload(role, size) {
      await pool.query("INSERT INTO upload_log (role, size_bytes) VALUES ($1, $2)", [role, size]);
    },
  };
}

// Placeholder used when DATABASE_URL is not set — every call 503s with a clear
// message; the rest of the API keeps working.
function makeUnconfiguredStore() {
  const fail = () => { throw new ApiError(503, "document store not configured (set DATABASE_URL in api/.env, then `npm run migrate`)"); };
  return {
    configured: false,
    hashOnly: fail,
    put: async () => fail(),
    get: async () => fail(),
    meta: async () => fail(),
    verify: async () => fail(),
  };
}

module.exports = { makeDocStore, makeUnconfiguredStore, sha256Hex };
