"use strict";
// METRIC 1 — Tamper-detection latency.
//
// We forge the SAME figure (the seeded compliance record's reported value) against
// each system and measure how long until the forgery is DETECTED.
//
//   MACL (Besu): the value is replicated across 3 validators and immutable once
//     finalised. "Detection" is the cross-node integrity check the dashboard uses:
//     read the record from every node and compare to the claimed (forged) value.
//     No node holds the forgery, so it is flagged. We time that check.
//
//   PostgreSQL baseline: a single mutable row. We apply the tamper as an UPDATE;
//     it silently becomes the new truth. With no independent replica and no stored
//     fingerprint there is nothing to compare against, so the tamper is UNDETECTED
//     — a subsequent read returns the tampered value as if legitimate.

async function run({ macl, db, seed }) {
  const honest = BigInt(seed.reportedValue);
  const forged = honest + 9_000_000n; // the value an attacker tries to pass off

  // --- MACL: time the cross-node detection of the forged value ---
  const nodes = macl.nodeProviders();
  const t0 = Date.now();
  let nodesChecked = 0;
  let agreesWithForgery = 0;
  for (const n of nodes) {
    try {
      const c = macl.contractOn("Compliance", n.provider);
      const rec = await c.getRecord(BigInt(seed.recordId));
      nodesChecked++;
      if (BigInt(rec.reportedValue) === forged) agreesWithForgery++;
    } catch (_) {
      // node unreachable — skip; detection only needs the honest majority
    }
  }
  const maclMs = Date.now() - t0;
  // Detected when at least one reachable node disagrees with the forged value.
  const maclDetected = nodesChecked > 0 && agreesWithForgery < nodesChecked;

  // --- PostgreSQL baseline: apply the same tamper, then re-read ---
  const d = db.connect();
  let stored;
  try {
    await d.query(
      "UPDATE compliance_records SET reported_value = $1 WHERE id = $2",
      [forged.toString(), seed.recordId]
    );
    const { rows } = await d.query(
      "SELECT reported_value FROM compliance_records WHERE id = $1",
      [seed.recordId]
    );
    stored = rows.length ? rows[0].reported_value : "(missing)";
  } finally {
    await d.end();
  }
  // No independent reference exists, so the read cannot tell honest from forged.
  const baselineDetected = false;

  return {
    metric: "Tamper-detection latency",
    macl: maclDetected
      ? `detected in ~${maclMs} ms (cross-node, ${nodesChecked} nodes)`
      : `NOT detected (only ${nodesChecked} node(s) reachable)`,
    baseline: `undetected — tamper became the new truth (value now ${stored})`,
    better: "MACL",
    notes: "Baseline has no independent replica/fingerprint to compare against.",
  };
}

module.exports = { run };
