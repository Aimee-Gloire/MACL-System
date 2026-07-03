"use strict";
// Small shared helpers for the evaluation harness.

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Find a named event in a transaction receipt's logs and return its parsed form.
function pickEvent(contract, receipt, name) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed && parsed.name === name) return parsed;
    } catch (_) {
      // not one of this contract's events — skip
    }
  }
  throw new Error(`Event ${name} not found in transaction logs`);
}

module.exports = { sleep, pickEvent };
