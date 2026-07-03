"use strict";
// Bridge to the MACL side (Besu + the three contracts).
// Reuses the dashboard's config.js (RPC, addresses, role keys) and the compiled
// ABIs, so the evaluation harness talks to the SAME chain as the live dashboard
// with no duplicated configuration.

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ROOT = path.join(__dirname, "..", "..");

// config.js is a browser script that assigns window.MACL_CONFIG. Load it in Node
// by evaluating it with a stand-in `window` and returning the object it built.
function loadConfig() {
  const code = fs.readFileSync(path.join(ROOT, "dashboard", "config.js"), "utf8");
  const build = new Function("window", code + "\n;return window.MACL_CONFIG;");
  return build({});
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
  const rpc = process.env.BESU_RPC_URL || cfg.RPC_URL;
  const provider = new ethers.JsonRpcProvider(rpc);

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
