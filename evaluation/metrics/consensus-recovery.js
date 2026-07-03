"use strict";
// METRIC 2 — Consensus recovery time.
//
//   MACL (Besu): take one validator offline (simulating tamper/outage), let the
//     2-of-3 majority keep producing the canonical chain, then bring the node
//     back and measure how long until it RESYNCS to the majority height. QBFT
//     forces the rejoining node to the canonical chain; its divergence is dropped.
//     Reuses the project's blockchain/tamper-demo.sh helper for stop/start.
//
//   PostgreSQL baseline: a single instance has no consensus and no replica, so a
//     corrupted/lost row has no automatic recovery — reported as N/A.

const { execFileSync } = require("child_process");
const path = require("path");
const { sleep } = require("../lib/util");

const TAMPER_SH = path.join(__dirname, "..", "..", "blockchain", "tamper-demo.sh");

async function run({ macl }) {
  const NODE = Number(process.env.EVAL_RECOVERY_NODE || 3);
  const TIMEOUT_S = Number(process.env.EVAL_RECOVERY_TIMEOUT || 120);

  const nodes = macl.nodeProviders();
  if (nodes.length < 3) throw new Error("need 3 node endpoints (set NODE_RPC_URLS in evaluation/.env)");
  if (NODE < 1 || NODE > nodes.length) throw new Error(`EVAL_RECOVERY_NODE out of range: ${NODE}`);

  const target = nodes[NODE - 1];
  const others = nodes.filter((_, i) => i !== NODE - 1);

  const heightOf = async (p) => Number(await p.getBlockNumber());
  const majorityHeight = async () =>
    Math.max(...(await Promise.all(others.map((o) => heightOf(o.provider)))));

  // 1) Stop the node (simulate tamper/outage).
  sh("stop", NODE);
  // 2) Let the 2-of-3 majority advance a few blocks.
  await sleep(8000);
  const majAtRestart = await majorityHeight();

  // 3) Bring it back and time the resync to the majority.
  const t0 = Date.now();
  sh("start", NODE);

  let recovered = false;
  let secs = 0;
  while ((Date.now() - t0) / 1000 < TIMEOUT_S) {
    await sleep(2000);
    let h;
    try {
      h = await heightOf(target.provider);
    } catch (_) {
      continue; // node still booting / RPC not up yet
    }
    const maj = await majorityHeight();
    // Caught up: at least the height the majority had at restart, and within 1 of "now".
    if (h >= majAtRestart && h >= maj - 1) {
      recovered = true;
      secs = (Date.now() - t0) / 1000;
      break;
    }
  }

  return {
    metric: "Consensus recovery time",
    macl: recovered
      ? `~${secs.toFixed(1)} s (node ${NODE} resynced to majority)`
      : `> ${TIMEOUT_S} s (not recovered within timeout)`,
    baseline: "N/A (single instance — no consensus or replica to recover from)",
    better: "MACL",
    notes: `Stopped node ${NODE}; majority advanced; node rejoined and caught up.`,
  };
}

function sh(action, node) {
  execFileSync("bash", [TAMPER_SH, action, String(node)], { stdio: "inherit" });
}

module.exports = { run };
