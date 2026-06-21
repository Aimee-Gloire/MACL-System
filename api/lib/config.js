"use strict";
// Central config for the API, all from server-side env (with sensible
// fresh-chain defaults). Nothing here is sent to the browser.

function config() {
  return {
    port: Number(process.env.PORT || 3001),
    // S4 / F-10: pin CORS to the dashboard origin(s) instead of "*". Comma-separated
    // list → only those browser origins may call the API. Default covers the
    // documented local dashboard (served on :8080 via localhost or 127.0.0.1).
    corsOrigin: (process.env.CORS_ORIGIN || "http://localhost:8080,http://127.0.0.1:8080")
      .split(",").map((s) => s.trim()).filter(Boolean),

    rpcUrl: process.env.BESU_RPC_URL || "http://127.0.0.1:8545",
    nodeUrls: (process.env.NODE_RPC_URLS ||
      "http://127.0.0.1:8545,http://127.0.0.1:8546,http://127.0.0.1:8547")
      .split(",").map((s) => s.trim()).filter(Boolean),
    // Labels for the cross-node panel (browser only ever sees these, never URLs).
    nodeLabels: ["Node-1 (NGO)", "Node-2 (Ministry)", "Node-3 (Donor)"],

    addresses: {
      Agreement: process.env.AGREEMENT_ADDRESS || "0x42699A7612A82f1d9C36148af9C77354759b210b",
      Compliance: process.env.COMPLIANCE_ADDRESS || "0xa50a51c09a5c451C52BB714527E1974b686D8e77",
      Verification: process.env.VERIFICATION_ADDRESS || "0x9a3DBCa554e9f6b9257aAa24010DA8377C57c17e",
    },

    // role -> env var holding that role's private key (server-side only).
    roleKeyEnv: {
      donor: "DONOR_PRIVATE_KEY",
      ngo: "NGO_PRIVATE_KEY",
      audit: "AUDIT_PRIVATE_KEY",
    },
    ownerKeyEnv: "OWNER_PRIVATE_KEY",

    endorsementThreshold: 2,
  };
}

module.exports = { config };
