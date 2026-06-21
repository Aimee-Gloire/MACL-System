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

const MAX_UPLOAD = "25mb";
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
    const out = await docs.put(buf, {
      contentType: req.get("content-type") || null,
      filename: req.query.filename ? String(req.query.filename) : null,
    });
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

  // Download the stored file.
  r.get("/:hash", h(async (req, res) => {
    const doc = await docs.get(requireHash(req.params.hash));
    if (!doc) throw new ApiError(404, "no stored document for that hash");
    res.setHeader("Content-Type", doc.contentType || "application/octet-stream");
    res.setHeader("Content-Length", doc.size);
    const safe = (doc.filename || `${doc.hash}.bin`).replace(/[^\w.\-]+/g, "_");
    res.setHeader("Content-Disposition", `inline; filename="${safe}"`);
    res.send(doc.content);
  }));

  return r;
}

module.exports = { makeDocsRouter };
