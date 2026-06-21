"use strict";
// Load the compiled contract ABIs from the Hardhat artifacts (single source of
// truth — same files the contracts are compiled to). The API loads these from
// disk; the browser no longer loads ABIs at all.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

function loadAbi(name) {
  const p = path.join(ROOT, "contracts", "artifacts", "contracts", `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(p)) {
    throw new Error(`ABI not found: ${p}\n  Run \`cd contracts && npx hardhat compile\` first.`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8")).abi;
}

function loadAbis() {
  return {
    Agreement: loadAbi("AgreementContract"),
    Compliance: loadAbi("ComplianceEvaluationContract"),
    Verification: loadAbi("VerificationWorkflowContract"),
  };
}

module.exports = { loadAbi, loadAbis };
