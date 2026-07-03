"use strict";
// Thin wrapper around the PostgreSQL baseline connection (the control group).

const { Pool } = require("pg");

function connect() {
  const pool = new Pool({
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "macl",
    password: process.env.PGPASSWORD || "macl",
    database: process.env.PGDATABASE || "macl_baseline",
  });
  return {
    pool,
    query: (text, params) => pool.query(text, params),
    end: () => pool.end(),
  };
}

module.exports = { connect };
