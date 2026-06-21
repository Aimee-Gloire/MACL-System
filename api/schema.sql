-- BL-12: off-chain document store (Neon / Postgres).
-- The chain keeps only the SHA-256 hash of a file; THIS table keeps the actual
-- bytes + metadata, keyed by that same hash. Because the primary key IS the
-- on-chain hash, "does the stored file match the ledger?" is just: look it up by
-- the on-chain hash and re-hash the bytes.
--
-- For capstone scale, storing files as BYTEA inline is fine.

CREATE TABLE IF NOT EXISTS documents (
  hash         TEXT        PRIMARY KEY,   -- 0x-prefixed lowercase SHA-256 (matches the bytes32 on-chain)
  content      BYTEA       NOT NULL,      -- the file itself
  content_type TEXT,                      -- e.g. application/pdf, image/png
  filename     TEXT,                      -- original filename (for download)
  size_bytes   BIGINT      NOT NULL,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
