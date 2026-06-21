"use strict";
// BL-12 document endpoints, mounted at /api/documents.
//
// The chain stores only a file's SHA-256; these endpoints store/serve the actual
// file, keyed by that same hash:
//   POST /upload          store a file -> { hash, ... }  (put the hash on-chain)
//   POST /hash            hash a file WITHOUT storing -> { hash, size }  (verify a candidate)
//   GET  /:hash           download the stored file
//   GET  /:hash/meta      metadata only ({ stored, size, filename, ... })
//   GET  /:hash/verify    re-hash the STORED bytes vs the (on-chain) hash -> { stored, match }
//
// Handlers are identity-agnostic so BL-13 can drop auth middleware in front of
// this router (or specific verbs) without changing any of them.

const express = require("express");
const { ApiError } = require("./lib/chain");

// S5 / F-15: cap a single evidence file to a sane size (was 25mb).
const MAX_UPLOAD = "8mb";
// S5 / F-15: per-role, per-day upload caps (env-overridable for tests/deploys).
const MAX_UPLOADS_PER_DAY = Number(process.env.MAX_UPLOADS_PER_DAY || 100);
const MAX_UPLOAD_MB_PER_DAY = Number(process.env.MAX_UPLOAD_MB_PER_DAY || 100);
const MAX_BYTES_PER_DAY = MAX_UPLOAD_MB_PER_DAY * 1024 * 1024;

// S5 / F-06 + F-15: the only content types we accept on upload and serve as-is on
// download. Anything else is refused on upload and served as a binary attachment
// on download (so a stored .html/.svg can never render in our origin).
const ALLOWED_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "text/plain"]);
const baseMime = (ct) => String(ct || "").split(";")[0].trim().toLowerCase();

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

function requireHash(h) {
  if (!HASH_RE.test(String(h))) throw new ApiError(400, `invalid hash: ${h}`);
  return String(h).toLowerCase();
}

function makeDocsRouter(docs) {
  const r = express.Router();
  const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const raw = express.raw({ type: () => true, limit: MAX_UPLOAD });

  // Store a file. Body is the raw bytes; filename via ?filename=, type via Content-Type.
  r.post("/upload", raw, h(async (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) throw new ApiError(400, "empty upload body");
    // F-15: reject content types outside the evidence allow-list at upload time.
    const ctype = baseMime(req.get("content-type"));
    if (!ALLOWED_TYPES.has(ctype)) {
      throw new ApiError(415, `unsupported file type "${ctype || "unknown"}" — allowed: ${[...ALLOWED_TYPES].join(", ")}`);
    }
    // F-15: per-role, per-day quota (only when the store can account for it).
    const role = (req.auth && req.auth.role) || "unknown";
    if (typeof docs.dailyUploadUsage === "function") {
      const used = await docs.dailyUploadUsage(role);
      if (used.count >= MAX_UPLOADS_PER_DAY || used.bytes + buf.length > MAX_BYTES_PER_DAY) {
        throw new ApiError(429, `daily upload limit reached for ${role} (max ${MAX_UPLOADS_PER_DAY} files / ${MAX_UPLOAD_MB_PER_DAY} MB per day) — try again tomorrow`);
      }
    }
    const out = await docs.put(buf, {
      contentType: ctype,
      filename: req.query.filename ? String(req.query.filename) : null,
    });
    if (typeof docs.recordUpload === "function") await docs.recordUpload(role, buf.length);
    res.json(out);
  }));

  // Hash a candidate file WITHOUT storing it (server-side hashing for verify).
  r.post("/hash", raw, h(async (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) throw new ApiError(400, "empty body");
    res.json(docs.hashOnly(buf));
  }));

  // Metadata only.
  r.get("/:hash/meta", h(async (req, res) => {
    res.json(await docs.meta(requireHash(req.params.hash)));
  }));

  // Verify the STORED file against its hash (the on-chain hash, since it's the key).
  r.get("/:hash/verify", h(async (req, res) => {
    res.json(await docs.verify(requireHash(req.params.hash)));
  }));

  // Download the stored file. S5 / F-06: a stored evidence file must NEVER be able
  // to render (and run script) in our origin. So:
  //   - X-Content-Type-Options: nosniff  → the browser won't MIME-sniff the bytes;
  //   - Content-Disposition: attachment   → it's downloaded, not displayed inline;
  //   - the Content-Type is restricted to the allow-list, anything else degrades to
  //     application/octet-stream — so even a stored .html/.svg comes down as a file.
  r.get("/:hash", h(async (req, res) => {
    const doc = await docs.get(requireHash(req.params.hash));
    if (!doc) throw new ApiError(404, "no stored document for that hash");
    const declared = baseMime(doc.contentType);
    const safeType = ALLOWED_TYPES.has(declared) ? declared : "application/octet-stream";
    const safe = (doc.filename || `${doc.hash}.bin`).replace(/[^\w.\-]+/g, "_");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", safeType);
    res.setHeader("Content-Length", doc.size);
    res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
    res.send(doc.content);
  }));

  return r;
}

module.exports = { makeDocsRouter };
