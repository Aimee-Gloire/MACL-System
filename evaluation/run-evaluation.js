"use strict";
// Orchestrates the RQ3 comparison: runs each metric against the live MACL (Besu)
// network and the PostgreSQL baseline, then writes a results table for the report.
//
// Prereqs (see README.md):
//   - 3-node Besu network up; contracts deployed (org registry seeded).
//   - PostgreSQL baseline up (docker compose up -d in this folder).
//   - `npm run seed` has been run (creates .last-seed.json).
//
// Note: the metrics MUTATE state (they tamper the baseline row and append MACL
// records), so re-run `npm run seed` before each fresh evaluation pass.
//
// Flags:
//   --no-consensus   skip the consensus-recovery metric (it stops/starts a node).

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const macl = require("./lib/macl");
const db = require("./lib/db");
const report = require("./lib/report");

const SEED_FILE = path.join(__dirname, ".last-seed.json");
const RESULTS_DIR = path.join(__dirname, "results");

// Order matters: consensus-recovery stops/starts a node, so run it last.
const METRICS = [
  { key: "tamper-detection", mod: "./metrics/tamper-detection" },
  { key: "audit-completeness", mod: "./metrics/audit-completeness" },
  { key: "consensus-recovery", mod: "./metrics/consensus-recovery" },
];

async function main() {
  if (!fs.existsSync(SEED_FILE)) {
    throw new Error("No seed found. Run `npm run seed` first (needs live Besu + PostgreSQL).");
  }
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
  const conn = macl.connect();
  const ctx = { macl: conn, db, seed };

  const skipConsensus = process.argv.includes("--no-consensus");
  const rows = [];

  for (const m of METRICS) {
    if (m.key === "consensus-recovery" && skipConsensus) {
      rows.push({
        metric: "Consensus recovery time",
        macl: "skipped (--no-consensus)",
        baseline: "N/A (single instance)",
        better: "—",
        notes: "",
      });
      continue;
    }
    process.stdout.write(`\n>> Running ${m.key}…\n`);
    try {
      const { run } = require(m.mod);
      rows.push(await run(ctx));
    } catch (e) {
      rows.push({
        metric: m.key,
        macl: "ERROR",
        baseline: "ERROR",
        better: "—",
        notes: String(e.message || e),
      });
      console.error(`   ${m.key} failed:`, e.message || e);
    }
  }

  const { md, csv } = report.render(rows);
  const stamp = new Date().toISOString();
  const header =
    `# MACL (Besu) vs PostgreSQL baseline — RQ3 evaluation results\n\n` +
    `Generated: ${stamp}\n` +
    `Seed: agreement ${seed.agreementId}, record ${seed.recordId}\n\n`;

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, "metrics.md"), header + md + "\n");
  fs.writeFileSync(path.join(RESULTS_DIR, "metrics.csv"), csv + "\n");

  console.log("\n" + md + "\n");
  console.log("Wrote results/metrics.md and results/metrics.csv");
}

main().catch((e) => {
  console.error("\nEvaluation failed:", e.message || e);
  process.exit(1);
});
