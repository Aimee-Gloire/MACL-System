"use strict";
// Entry point: load env, build the app, listen.

require("dotenv").config();
const { createApp } = require("./app");
const { rolesWithoutPasswordHash } = require("./lib/auth");

// createApp() validates JWT_SECRET (fail-closed, F-01) — if it is missing or too
// short this throws here and the process exits before listening, by design.
const { app, cfg, docs } = createApp();

app.listen(cfg.port, () => {
  console.log(`MACL API listening on http://127.0.0.1:${cfg.port}`);
  console.log(`  chain RPC : ${cfg.rpcUrl}`);
  console.log(`  nodes     : ${cfg.nodeUrls.length} validator RPC(s) (server-side only)`);
  console.log(`  contracts : ${JSON.stringify(cfg.addresses)}`);
  console.log(`  documents : ${docs.configured ? "Neon/Postgres store ready" : "NOT configured (set DATABASE_URL + npm run migrate)"}`);
  console.log(`  auth      : JWT login enabled (per-org); secret OK (>= 32 chars)`);
  const missing = rolesWithoutPasswordHash();
  if (missing.length) {
    console.warn(`  WARNING   : no password hash set for: ${missing.join(", ")} — ${missing.length === 1 ? "that role" : "those roles"} cannot log in. ` +
      `Set ${missing.map((r) => r.toUpperCase() + "_PW_HASH").join(" / ")} in api/.env (generate with: node scripts/hash-password.js <password>).`);
  }
});
