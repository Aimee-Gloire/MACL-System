"use strict";
// Provisioning helper (S1 / F-03): turn a plaintext password into a bcrypt hash
// to paste into api/.env as DONOR_PW_HASH / NGO_PW_HASH / AUDIT_PW_HASH.
//
// Usage:
//   cd api && node scripts/hash-password.js '<the password>'
//
// It only PRINTS the hash; it never writes any file and never stores the password.
// The plaintext password itself is never kept anywhere — only its one-way hash is.

const bcrypt = require("bcrypt");

const SALT_ROUNDS = 12; // cost factor; higher = slower to brute-force.

async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error("Usage: node scripts/hash-password.js '<password>'");
    console.error("Prints a bcrypt hash to paste into api/.env (e.g. DONOR_PW_HASH=...).");
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  console.log(hash);
}

main().catch((e) => {
  console.error("Failed to hash password:", e.message || e);
  process.exit(1);
});
