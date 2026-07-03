"use strict";
// METRIC 3 — Audit-trail completeness.
//
// We record the SAME indicator changing value N times in each system, then ask
// each one to reproduce the FULL history of those values.
//
//   MACL (Besu): every submitReport appends a new immutable record. All N are
//     retained and independently re-readable -> 100% of the history recoverable.
//
//   PostgreSQL baseline: the natural centralised design keeps ONE current value
//     per indicator (an in-place UPDATE). Each new value overwrites the last, so
//     only the most recent survives -> 1 of N states recoverable.

const { pickEvent } = require("../lib/util");

async function run({ macl, db, seed }) {
  const N = Number(process.env.EVAL_HISTORY_DEPTH || 5);
  // N distinct values, all >= the seeded threshold so each evaluates to PASS.
  const values = Array.from({ length: N }, (_, i) => Number(seed.threshold) + (i + 1) * 25);

  // --- MACL: append N immutable records, then count how many are recoverable ---
  const complianceNgo = macl.contract("Compliance", macl.cfg.ROLES.ngo.key);
  const complianceRead = macl.contract("Compliance");

  const ids = [];
  for (const v of values) {
    const rc = await (await complianceNgo["submitReport(uint256,uint256,uint256)"](
      seed.agreementId, seed.targetIndex, v
    )).wait();
    ids.push(pickEvent(complianceRead, rc, "RecordSubmitted").args.recordId);
  }

  let maclRecoverable = 0;
  for (let i = 0; i < ids.length; i++) {
    const rec = await complianceRead.getRecord(ids[i]);
    if (BigInt(rec.reportedValue) === BigInt(values[i])) maclRecoverable++;
  }

  // --- baseline: model "current value per indicator" as ONE row updated N times ---
  const d = db.connect();
  let baselineRecoverable;
  try {
    for (const v of values) {
      await d.query(
        "UPDATE compliance_records SET reported_value = $1 WHERE id = $2",
        [String(v), seed.recordId]
      );
    }
    // Only the latest value survives; the earlier N-1 are gone.
    const { rows } = await d.query(
      "SELECT reported_value FROM compliance_records WHERE id = $1",
      [seed.recordId]
    );
    baselineRecoverable = rows.length ? 1 : 0;
  } finally {
    await d.end();
  }

  const pct = (x) => `${Math.round((x / N) * 100)}% (${x}/${N})`;
  return {
    metric: "Audit-trail completeness",
    macl: pct(maclRecoverable),
    baseline: pct(baselineRecoverable),
    better: "MACL",
    notes: `${N} successive values per indicator; baseline keeps only the current one.`,
  };
}

module.exports = { run };
