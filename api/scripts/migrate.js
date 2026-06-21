"use strict";
// Apply api/schema.sql to the configured Postgres (Neon) database.
// Usage: cd api && npm run migrate   (needs DATABASE_URL in api/.env)

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { makePool } = require("../lib/db");

async function main() {
  const pool = makePool();
  if (!pool) {
    console.error("DATABASE_URL is not set in api/.env — nothing to migrate.");
    process.exit(1);
  }
  const sql = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("Migration applied: documents table is ready.");
  await pool.end();
}

main().catch((e) => {
  console.error("Migration failed:", e.message || e);
  process.exit(1);
});
