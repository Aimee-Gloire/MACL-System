"use strict";
// Bridge to the MACL side (Besu + the three contracts).
//
// Self-contained: the harness reads its RPC URL, the three node endpoints, the
// deployed contract addresses and the three org signing keys from its OWN
// environment (evaluation/.env — copy from .env.example), with sensible
// fresh-chain defaults. It no longer depends on dashboard/config.js (which, since
// the move to the three-tier design, holds none of these — they now live
// server-side in api/.env). The ABIs are read from the compiled Hardhat artifacts.

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ROOT = path.join(__dirname, "..", "..");

// Build the harness config from environment variables (with fresh-chain
// defaults). Every default below is PUBLIC test material for the isolated local
// Besu network — the well-known Hardhat/Besu keys, the same ones in
// api/.env.example — and controls no real funds. Override any in evaluation/.env.
function loadConfig() {
  const RPC_URL = process.env.BESU_RPC_URL || "http://127.0.0.1:8545";

  const NODE_URLS = (
    process.env.NODE_RPC_URLS ||
    "http://127.0.0.1:8545,http://127.0.0.1:8546,http://127.0.0.1:8547"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const NODE_LABELS = ["Node-1 (NGO)", "Node-2 (Ministry)", "Node-3 (Donor)"];
  const NODES = NODE_URLS.map((url, i) => ({ label: NODE_LABELS[i] || `Node-${i + 1}`, url }));

  const ADDRESSES = {
    Agreement: process.env.AGREEMENT_ADDRESS || "0x42699A7612A82f1d9C36148af9C77354759b210b",
    Compliance: process.env.COMPLIANCE_ADDRESS || "0xa50a51c09a5c451C52BB714527E1974b686D8e77",
    Verification: process.env.VERIFICATION_ADDRESS || "0x9a3DBCa554e9f6b9257aAa24010DA8377C57c17e",
  };

  // The three participating orgs: on-chain address + signing key.
  const ROLES = {
    donor: {
      address: process.env.DONOR_ADDRESS || "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      key: process.env.DONOR_PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    },
    ngo: {
      address: process.env.NGO_ADDRESS || "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      key: process.env.NGO_PRIVATE_KEY || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    },
    audit: {
      address: process.env.AUDIT_ADDRESS || "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      key: process.env.AUDIT_PRIVATE_KEY || "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    },
  };

  return { RPC_URL, NODES, ADDRESSES, ROLES };
}

function loadAbi(contractName) {
  const p = path.join(
    ROOT, "contracts", "artifacts", "contracts",
    `${contractName}.sol`, `${contractName}.json`
  );
  if (!fs.existsSync(p)) {
    throw new Error(`ABI not found: ${p}\n  Run \`cd contracts && npx hardhat compile\` first.`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8")).abi;
}

function connect() {
  const cfg = loadConfig();
  const provider = new ethers.JsonRpcProvider(cfg.RPC_URL);

  const ABIS = {
    Agreement: loadAbi("AgreementContract"),
    Compliance: loadAbi("ComplianceEvaluationContract"),
    Verification: loadAbi("VerificationWorkflowContract"),
  };

  // contract("Agreement")        -> read-only (provider-bound)
  // contract("Agreement", key)   -> write-capable (signer-bound)
  function contract(name, key) {
    const runner = key ? new ethers.Wallet(key, provider) : provider;
    return new ethers.Contract(cfg.ADDRESSES[name], ABIS[name], runner);
  }

  // Same contract, bound to a specific node's provider (for cross-node reads).
  function contractOn(name, nodeProvider) {
    return new ethers.Contract(cfg.ADDRESSES[name], ABIS[name], nodeProvider);
  }

  // One read-only provider per Besu validator endpoint.
  function nodeProviders() {
    return cfg.NODES.map((n) => ({
      label: n.label,
      url: n.url,
      provider: new ethers.JsonRpcProvider(n.url),
    }));
  }

  return { cfg, provider, abis: ABIS, contract, contractOn, nodeProviders };
}

module.exports = { loadConfig, loadAbi, connect };
