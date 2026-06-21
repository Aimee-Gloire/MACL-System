"use strict";
// Entry point: load env, build the app, listen.

require("dotenv").config();
const { createApp } = require("./app");
const { usingDefaultSecret, usingDefaultPasswords } = require("./lib/auth");

const { app, cfg, docs } = createApp();

app.listen(cfg.port, () => {
  console.log(`MACL API listening on http://127.0.0.1:${cfg.port}`);
  console.log(`  chain RPC : ${cfg.rpcUrl}`);
  console.log(`  nodes     : ${cfg.nodeUrls.length} validator RPC(s) (server-side only)`);
  console.log(`  contracts : ${JSON.stringify(cfg.addresses)}`);
  console.log(`  documents : ${docs.configured ? "Neon/Postgres store ready" : "NOT configured (set DATABASE_URL + npm run migrate)"}`);
  console.log(`  auth      : JWT login enabled (per-org)`);
  if (usingDefaultSecret()) {
    console.warn("  WARNING   : JWT_SECRET is not set — using an insecure default. Set JWT_SECRET in api/.env.");
  }
  if (usingDefaultPasswords()) {
    console.warn("  WARNING   : one or more org login passwords are unset — using TEST defaults. Set DONOR/NGO/AUDIT_PASSWORD in api/.env before hosting.");
  }
});
