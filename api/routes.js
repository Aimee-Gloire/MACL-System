"use strict";
// REST routes — one endpoint per dashboard action, plus the reads and the
// cross-node integrity proxy.
//
// BL-13: the acting role is taken from the authenticated session (req.auth.role,
// set by the auth middleware in app.js) — NEVER from the request body. So a
// session can only ever act as the org it logged in as. Role-exclusive actions
// are additionally checked here for a clean 403 (the contracts remain the final
// authority on-chain).

const express = require("express");
const { ApiError } = require("./lib/chain");

function requireFields(body, fields) {
  for (const f of fields) {
    if (body[f] === undefined || body[f] === null || body[f] === "") {
      throw new ApiError(400, `missing field: ${f}`);
    }
  }
}
function intParam(v, name) {
  if (!/^\d+$/.test(String(v))) throw new ApiError(400, `invalid ${name}: ${v}`);
  return String(v);
}

// Which single role may perform a role-exclusive action (mirrors the on-chain
// gates). Actions not listed (endorse/decline records & spend) are open to any
// authenticated org; the contracts still enforce signatory membership etc.
const ACTION_ROLE = {
  "agreement.create": "donor",
  "agreement.addTarget": "donor",
  "agreement.finalise": "donor",
  "budget.set": "donor",
  "report.submit": "ngo",
  "spend.request": "ngo",
  "spend.markSpent": "ngo",
  // S3 / F-04: registering an organisation is signed with the OWNER key, so only
  // the dedicated admin login may invoke it. Every other role gets a clean 403.
  "org.register": "admin",
};
function requirePerm(req, action) {
  const need = ACTION_ROLE[action];
  if (need && req.auth.role !== need) {
    throw new ApiError(403, `${req.auth.role} may not perform ${action} (requires ${need})`);
  }
}

function makeRouter(chain) {
  const r = express.Router();
  const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ---------------------------------------------------------------- reads
  // (auth is applied at mount time in app.js; /health is the public exception)
  r.get("/health", h(async (_req, res) => res.json(await chain.health())));
  r.get("/agreements", h(async (_req, res) => res.json(await chain.getAgreements())));
  r.get("/records", h(async (_req, res) => res.json(await chain.getRecords())));
  r.get("/spend", h(async (_req, res) => res.json(await chain.getSpend())));
  r.get("/nodes", h(async (_req, res) => res.json(await chain.getNodeStates())));
  r.get("/blocks/recent", h(async (req, res) => res.json(await chain.recentBlocks(Number(req.query.n) || 3))));
  r.get("/events/agreements", h(async (req, res) => res.json(await chain.agreementEvents(Number(req.query.limit) || 6))));
  r.get("/org/:address", h(async (req, res) => res.json(await chain.orgOf(req.params.address))));
  r.get("/agreements/:id/failing", h(async (req, res) =>
    res.json({ hasFailing: await chain.hasFailingRecords(intParam(req.params.id, "id")) })));
  r.get("/integrity/:kind/:id", h(async (req, res) => {
    const { kind } = req.params;
    if (kind !== "record" && kind !== "spend") throw new ApiError(400, `invalid kind: ${kind}`);
    res.json(await chain.getIntegrity(kind, intParam(req.params.id, "id")));
  }));

  // ---------------------------------------------------------------- writes
  // role = req.auth.role (from the JWT); body.role is ignored.
  r.post("/agreements", h(async (req, res) => {
    requirePerm(req, "agreement.create");
    requireFields(req.body, ["startDate", "endDate", "signatories"]);
    if (!Array.isArray(req.body.signatories) || !req.body.signatories.length) {
      throw new ApiError(400, "signatories must be a non-empty array");
    }
    res.json(await chain.createAgreement(req.auth.role, req.body.startDate, req.body.endDate, req.body.signatories));
  }));

  r.post("/agreements/:id/targets", h(async (req, res) => {
    requirePerm(req, "agreement.addTarget");
    requireFields(req.body, ["indicator", "threshold", "unit", "deadline"]);
    res.json(await chain.addTarget(req.auth.role, intParam(req.params.id, "id"),
      req.body.indicator, req.body.threshold, req.body.unit, req.body.deadline));
  }));

  r.post("/agreements/:id/finalise", h(async (req, res) => {
    requirePerm(req, "agreement.finalise");
    res.json(await chain.finaliseAgreement(req.auth.role, intParam(req.params.id, "id")));
  }));

  r.post("/agreements/:id/budget", h(async (req, res) => {
    requirePerm(req, "budget.set");
    requireFields(req.body, ["amount"]);
    res.json(await chain.setBudget(req.auth.role, intParam(req.params.id, "id"), req.body.amount));
  }));

  // Owner-signed action (registers an org with the deployer key). S3 / F-04: now
  // restricted to the dedicated admin login — any other session gets a clean 403.
  r.post("/org/register", h(async (req, res) => {
    requirePerm(req, "org.register");
    requireFields(req.body, ["address", "orgType", "name"]);
    const result = await chain.registerOrg(req.body.address, req.body.orgType, req.body.name);
    // Audit line (feeds the structured audit log in Part S6): who registered whom.
    console.log(JSON.stringify({
      audit: "org.register",
      at: new Date().toISOString(),
      by: req.auth.role,
      address: req.body.address,
      orgType: req.body.orgType,
      tx: result.hash,
    }));
    res.json(result);
  }));

  r.post("/reports", h(async (req, res) => {
    requirePerm(req, "report.submit");
    requireFields(req.body, ["agreementId", "targetIndex", "value"]);
    res.json(await chain.submitReport(req.auth.role, req.body.agreementId, req.body.targetIndex,
      req.body.value, req.body.documentHash));
  }));

  r.post("/spend", h(async (req, res) => {
    requirePerm(req, "spend.request");
    requireFields(req.body, ["agreementId", "amount", "purpose"]);
    res.json(await chain.createSpendRequest(req.auth.role, req.body.agreementId, req.body.amount,
      req.body.purpose, req.body.documentHash));
  }));

  r.post("/spend/:id/endorse", h(async (req, res) =>
    res.json(await chain.endorseSpend(req.auth.role, intParam(req.params.id, "id")))));
  r.post("/spend/:id/decline", h(async (req, res) =>
    res.json(await chain.declineSpend(req.auth.role, intParam(req.params.id, "id")))));
  r.post("/spend/:id/spent", h(async (req, res) => {
    requirePerm(req, "spend.markSpent");
    requireFields(req.body, ["receiptHash"]);
    res.json(await chain.markSpent(req.auth.role, intParam(req.params.id, "id"), req.body.receiptHash));
  }));

  r.post("/records/:id/endorse", h(async (req, res) =>
    res.json(await chain.endorseRecord(req.auth.role, intParam(req.params.id, "id")))));
  r.post("/records/:id/decline", h(async (req, res) =>
    res.json(await chain.declineRecord(req.auth.role, intParam(req.params.id, "id")))));
  // BL-9: after the verification window passes, a signatory marks a stale record UNVERIFIED.
  r.post("/records/:id/expire", h(async (req, res) =>
    res.json(await chain.markRecordUnverified(req.auth.role, intParam(req.params.id, "id")))));

  return r;
}

module.exports = { makeRouter };
