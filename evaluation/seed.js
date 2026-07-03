"use strict";
// Seed BOTH systems with the SAME programme data, so the metric scripts can apply
// an identical tamper to each and compare. MACL is seeded first (it is the
// canonical source), then those exact on-chain values are mirrored into the
// PostgreSQL baseline. Writes .last-seed.json with the ids the metrics target.

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const macl = require("./lib/macl");
const db = require("./lib/db");
const { pickEvent } = require("./lib/util");

const SEED_FILE = path.join(__dirname, ".last-seed.json");

async function main() {
  const { cfg, contract } = macl.connect();
  const donor = cfg.ROLES.donor;
  const ngo = cfg.ROLES.ngo;
  const audit = cfg.ROLES.audit; // the Ministry/Govt signatory

  const agreementRead = contract("Agreement");
  const agreementDonor = contract("Agreement", donor.key);
  const complianceRead = contract("Compliance");
  const complianceNgo = contract("Compliance", ngo.key);

  // Fail early with a clear message if the on-chain org registry was not seeded.
  const donorIsDonorOrg = await agreementRead.isOrgType(donor.address, 2); // 2 = Donor
  if (!donorIsDonorOrg) {
    throw new Error(
      "Donor org is not registered on-chain — createAgreement would revert.\n" +
      "  Run `cd contracts && npm run deploy:besu` (it seeds the org registry),\n" +
      "  then update dashboard/config.js ADDRESSES if the deploy printed new ones."
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const plan = {
    start: now,
    end: now + 365 * 24 * 3600,
    deadline: now + 180 * 24 * 3600,
    budget: 1000000,
    threshold: 500,
    reportedValue: 600, // >= threshold and before deadline -> PASS
    indicator: "beneficiaries_reached",
    unit: "people",
  };

  console.log("== Seeding MACL (canonical, on Besu) ==");
  let rc = await (await agreementDonor.createAgreement(
    plan.start, plan.end, [donor.address, ngo.address, audit.address]
  )).wait();
  const agreementId = pickEvent(agreementRead, rc, "AgreementCreated").args.id;
  console.log("  agreement id:", agreementId.toString());

  await (await agreementDonor.addTarget(agreementId, plan.indicator, plan.threshold, plan.unit, plan.deadline)).wait();
  await (await agreementDonor.setBudget(agreementId, plan.budget)).wait();
  await (await agreementDonor.finaliseAgreement(agreementId)).wait();
  console.log("  target added, budget set, agreement finalised");

  rc = await (await complianceNgo["submitReport(uint256,uint256,uint256)"](agreementId, 0, plan.reportedValue)).wait();
  const recordId = pickEvent(complianceRead, rc, "RecordSubmitted").args.recordId;
  console.log("  compliance record id:", recordId.toString());

  // Read the canonical values back so the baseline is an EXACT mirror.
  const ag = await agreementRead.getAgreement(agreementId);
  const tgt = await agreementRead.getTarget(agreementId, 0);
  const rec = await complianceRead.getRecord(recordId);

  console.log("== Mirroring the same data into the PostgreSQL baseline ==");
  const d = db.connect();
  try {
    // Idempotent: clear any prior rows for this id, then insert the mirror.
    await d.query("DELETE FROM compliance_records WHERE agreement_id = $1", [agreementId.toString()]);
    await d.query("DELETE FROM targets WHERE agreement_id = $1", [agreementId.toString()]);
    await d.query("DELETE FROM agreements WHERE id = $1", [agreementId.toString()]);

    await d.query(
      `INSERT INTO agreements (id, creator, start_date, end_date, finalised, budget, committed_spend)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [agreementId.toString(), ag.creator, ag.startDate.toString(), ag.endDate.toString(),
       ag.finalised, ag.budget.toString(), ag.committedSpend.toString()]
    );
    await d.query(
      `INSERT INTO targets (agreement_id, target_index, indicator, threshold, unit, deadline)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [agreementId.toString(), 0, tgt.indicator, tgt.threshold.toString(), tgt.unit, tgt.deadline.toString()]
    );
    await d.query(
      `INSERT INTO compliance_records
         (id, agreement_id, target_index, reported_value, result, evaluated_at, submitter, finalised, document_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [recordId.toString(), agreementId.toString(), 0, rec.reportedValue.toString(), Number(rec.result),
       rec.evaluatedAt.toString(), rec.submitter, rec.finalised, rec.documentHash]
    );
    console.log("  baseline rows inserted (agreement, target, compliance record)");
  } finally {
    await d.end();
  }

  const seed = {
    agreementId: agreementId.toString(),
    recordId: recordId.toString(),
    targetIndex: 0,
    budget: plan.budget,
    reportedValue: plan.reportedValue,
    threshold: plan.threshold,
    seededAt: new Date().toISOString(),
  };
  fs.writeFileSync(SEED_FILE, JSON.stringify(seed, null, 2));
  console.log("\nSeed complete. Wrote", path.relative(process.cwd(), SEED_FILE));
  console.log("Next: `npm run evaluate`");
}

main().catch((e) => {
  console.error("\nSeed failed:", e.message || e);
  process.exit(1);
});
