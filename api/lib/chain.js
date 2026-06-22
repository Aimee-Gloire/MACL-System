"use strict";
// The API's bridge to the Besu chain (ethers v6). Holds the signer keys
// server-side, exposes read + write helpers per contract action, and runs the
// cross-node integrity check against all three validator RPCs (never exposed to
// the browser). Everything returned here is plain JSON (BigInts -> strings).

const { ethers } = require("ethers");
const { loadAbis } = require("./abis");

// A clean error that carries an HTTP status + a human message for the routes.
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Pull a useful message out of an ethers/revert error.
function revertReason(err) {
  return (
    (err && err.revert && err.revert.args && err.revert.args[0]) ||
    (err && err.reason) ||
    (err && err.shortMessage) ||
    (err && err.info && err.info.error && err.info.error.message) ||
    (err && err.message) ||
    String(err)
  );
}

function makeChain(cfg) {
  const abis = loadAbis();
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);

  // One read-only provider per validator (for the cross-node integrity check).
  const nodes = cfg.nodeUrls.map((url, i) => ({
    label: cfg.nodeLabels[i] || `Node-${i + 1}`,
    provider: new ethers.JsonRpcProvider(url),
  }));

  // Read-only (provider-bound) contracts.
  const read = {
    agreement: new ethers.Contract(cfg.addresses.Agreement, abis.Agreement, provider),
    compliance: new ethers.Contract(cfg.addresses.Compliance, abis.Compliance, provider),
    verification: new ethers.Contract(cfg.addresses.Verification, abis.Verification, provider),
  };

  // --- signers (server-side keys only) ---
  function keyFor(role) {
    const envVar = cfg.roleKeyEnv[role];
    if (!envVar) throw new ApiError(400, `unknown role: ${role}`);
    const key = process.env[envVar];
    if (!key) throw new ApiError(500, `missing server key for role ${role} (${envVar})`);
    return key;
  }
  function signerFor(role) {
    return new ethers.Wallet(keyFor(role), provider);
  }
  function ownerSigner() {
    const key = process.env[cfg.ownerKeyEnv];
    if (!key) throw new ApiError(500, `missing ${cfg.ownerKeyEnv}`);
    return new ethers.Wallet(key, provider);
  }
  // Signer-bound contract for a write.
  function writeContract(name, signer) {
    return new ethers.Contract(cfg.addresses[name], abis[name], signer);
  }

  // The three known org addresses (derived from the role keys), for working out
  // who endorsed/declined each record without exposing keys.
  function orgAddresses() {
    const out = {};
    for (const role of Object.keys(cfg.roleKeyEnv)) {
      const key = process.env[cfg.roleKeyEnv[role]];
      if (key) out[role] = new ethers.Wallet(key).address;
    }
    return out;
  }

  // Run a write: send, wait for mining, return the receipt-ish summary.
  async function send(promise) {
    try {
      const tx = await promise;
      const receipt = await tx.wait();
      return { tx, receipt };
    } catch (err) {
      // A contract REVERT is a safe, client-actionable validation message (e.g.
      // "spend exceeds remaining budget", "cannot approve your own request") — keep
      // it as a clean 4xx so the user sees it. Anything else is an unexpected infra
      // error → 502, which the app's error handler genericises + logs (F-14).
      const isRevert = !!(err && (err.code === "CALL_EXCEPTION" || err.revert || err.reason));
      throw new ApiError(isRevert ? 400 : 502, revertReason(err));
    }
  }

  function eventArg(receipt, contract, name, arg) {
    for (const log of receipt.logs) {
      try {
        const p = contract.interface.parseLog(log);
        if (p && p.name === name) return p.args[arg];
      } catch (_) { /* not ours */ }
    }
    return null;
  }

  // Besu caps how many blocks one eth_getLogs may span (--rpc-max-logs-range,
  // default ~1000). On a long-running chain "block 0 -> latest" exceeds that, so
  // we page through the history in fixed windows and merge. Window is < the limit.
  const LOGS_WINDOW = Number(process.env.LOGS_WINDOW || 1000);
  async function queryLogs(contract, eventName) {
    const latest = await provider.getBlockNumber();
    const filter = contract.filters[eventName]();
    const out = [];
    for (let from = 0; from <= latest; from += LOGS_WINDOW) {
      const to = Math.min(from + LOGS_WINDOW - 1, latest);
      out.push(...(await contract.queryFilter(filter, from, to)));
    }
    return out;
  }

  // ------------------------------------------------------------------ READS
  async function getAgreements() {
    const logs = await queryLogs(read.agreement, "AgreementCreated");
    const ids = [...new Set(logs.map((l) => l.args.id.toString()))];
    const rows = [];
    for (const idStr of ids) {
      const id = BigInt(idStr);
      const a = await read.agreement.getAgreement(id);
      const count = await read.agreement.targetCount(id);
      const targets = [];
      for (let i = 0n; i < count; i++) {
        const t = await read.agreement.getTarget(id, i);
        targets.push({ indicator: t.indicator, threshold: t.threshold.toString(), unit: t.unit, deadline: t.deadline.toString() });
      }
      rows.push({
        id: idStr,
        a: {
          creator: a.creator,
          startDate: a.startDate.toString(),
          endDate: a.endDate.toString(),
          signatories: Array.from(a.signatories),
          finalised: a.finalised,
          budget: a.budget.toString(),
          committedSpend: a.committedSpend.toString(),
        },
        targets,
        finalised: a.finalised,
        budget: a.budget.toString(),
        committed: a.committedSpend.toString(),
        remaining: (a.budget - a.committedSpend).toString(),
      });
    }
    rows.sort((x, y) => Number(y.id) - Number(x.id));
    return rows;
  }

  async function getRecords() {
    const orgs = Object.values(orgAddresses());
    const logs = await queryLogs(read.compliance, "RecordSubmitted");
    const ids = [...new Set(logs.map((l) => l.args.recordId.toString()))];
    const rows = [];
    for (const idStr of ids) {
      const id = BigInt(idStr);
      const rec = await read.compliance.getRecord(id);
      const t = await read.agreement.getTarget(rec.agreementId, rec.targetIndex);
      const count = await read.verification.endorsementCount(id);
      const declines = await read.verification.declineCount(id);
      const blockHash = await read.verification.finalisedBlockHash(id);
      const expired = await read.verification.isExpired(id);              // BL-9: window passed, not finalised
      const deadline = await read.verification.verificationDeadline(id);  // evaluatedAt + window (unix)
      const endorsers = [];
      const decliners = [];
      for (const addr of orgs) {
        if (await read.verification.hasEndorsed(id, addr)) endorsers.push(addr);
        else if (await read.verification.hasDeclined(id, addr)) decliners.push(addr);
      }
      rows.push({
        rec: {
          id: rec.id.toString(),
          agreementId: rec.agreementId.toString(),
          targetIndex: rec.targetIndex.toString(),
          reportedValue: rec.reportedValue.toString(),
          result: Number(rec.result),
          evaluatedAt: rec.evaluatedAt.toString(),
          submitter: rec.submitter,
          finalised: rec.finalised,
          documentHash: rec.documentHash,
          unverified: rec.unverified,            // BL-9 terminal state
        },
        target: { indicator: t.indicator, threshold: t.threshold.toString(), unit: t.unit, deadline: t.deadline.toString() },
        count: Number(count),
        declines: Number(declines),
        blockHash,
        expired,                                  // window passed & not finalised (may not be marked yet)
        verificationDeadline: deadline.toString(),
        endorsers,
        decliners,
      });
    }
    rows.sort((a, b) => Number(b.rec.id) - Number(a.rec.id));
    return rows;
  }

  async function getSpend() {
    const orgs = Object.values(orgAddresses());
    const logs = await queryLogs(read.compliance, "SpendRequested");
    const ids = [...new Set(logs.map((l) => l.args.requestId.toString()))];
    const rows = [];
    for (const idStr of ids) {
      const id = BigInt(idStr);
      const s = await read.compliance.getSpendRequest(id);
      const count = await read.verification.spendEndorsementCount(id);
      const declines = await read.verification.spendDeclineCount(id);
      const endorsers = [];
      const decliners = [];
      for (const addr of orgs) {
        if (await read.verification.hasEndorsedSpend(id, addr)) endorsers.push(addr);
        else if (await read.verification.hasDeclinedSpend(id, addr)) decliners.push(addr);
      }
      rows.push({
        req: {
          id: s.id.toString(),
          agreementId: s.agreementId.toString(),
          amount: s.amount.toString(),
          purpose: s.purpose,
          documentHash: s.documentHash,
          requester: s.requester,
          createdAt: s.createdAt.toString(),
          approved: s.approved,
          spent: s.spent,
          receiptHash: s.receiptHash,
          spentAt: s.spentAt.toString(),
        },
        count: Number(count),
        declines: Number(declines),
        endorsers,
        decliners,
      });
    }
    rows.sort((a, b) => Number(b.req.id) - Number(a.req.id));
    return rows;
  }

  async function orgOf(address) {
    const o = await read.agreement.getOrganisation(address);
    return { registered: o.registered, orgType: Number(o.orgType), name: o.name };
  }

  async function hasFailingRecords(agreementId) {
    return await read.compliance.hasFailingRecords(BigInt(agreementId));
  }

  async function recentBlocks(n) {
    const head = await provider.getBlockNumber();
    const nums = [];
    for (let i = 0; i < n && head - i >= 0; i++) nums.push(head - i);
    const blks = await Promise.all(nums.map((x) => provider.getBlock(x)));
    return blks.filter(Boolean).map((b) => ({
      number: b.number,
      txCount: b.transactions.length,
      timestamp: b.timestamp,
    }));
  }

  async function agreementEvents(limit = 25) {
    const evs = [];
    // Every agreement lifecycle event, so the activity feed matches what's actually possible
    // (create, target add/edit/remove, date change, budget set, finalise).
    const EVENT_TYPES = [
      ["AgreementCreated", "created"],
      ["TargetAdded", "target added"],
      ["TargetEdited", "target edited"],
      ["TargetRemoved", "target removed"],
      ["AgreementDatesUpdated", "dates updated"],
      ["BudgetSet", "budget set"],
      ["AgreementFinalised", "locked"],
    ];
    for (const [name, label] of EVENT_TYPES) {
      const logs = await queryLogs(read.agreement, name);
      for (const log of logs) {
        const a = log.args;
        const id = (a.id ?? a.agreementId).toString();
        evs.push({ name, label, id, blockNumber: log.blockNumber });
      }
    }
    evs.sort((x, y) => Number(y.blockNumber) - Number(x.blockNumber));
    const top = evs.slice(0, limit);
    const blockTs = {};
    await Promise.all([...new Set(top.map((e) => e.blockNumber))].map(async (bn) => {
      blockTs[bn] = (await provider.getBlock(bn))?.timestamp || 0;
    }));
    return top.map((e) => ({ ...e, timestamp: blockTs[e.blockNumber] }));
  }

  // ------------------------------------------------------- cross-node integrity
  function mode(arr) {
    const c = {}; let best = null, bestN = 0;
    for (const x of arr) { c[x] = (c[x] || 0) + 1; if (c[x] > bestN) { bestN = c[x]; best = x; } }
    return best;
  }
  function recordFingerprint(kind, rec) {
    if (!rec || rec.id === 0n) return "absent";
    return kind === "spend"
      ? [rec.id, rec.amount, rec.approved, rec.documentHash, rec.spent, rec.receiptHash].join("|")
      : [rec.id, rec.reportedValue, rec.result, rec.finalised, rec.documentHash, rec.unverified].join("|");
  }

  async function getNodeStates() {
    const states = await Promise.all(nodes.map(async (n) => {
      try { return { label: n.label, ok: true, height: await n.provider.getBlockNumber() }; }
      catch (_) { return { label: n.label, ok: false, height: null }; }
    }));
    const reachable = states.filter((s) => s.ok);
    const maxH = reachable.length ? Math.max(...reachable.map((s) => s.height)) : 0;
    const commonH = reachable.length ? Math.min(...reachable.map((s) => s.height)) : 0;
    await Promise.all(states.map(async (s, i) => {
      if (!s.ok) return;
      try { const b = await nodes[i].provider.getBlock(commonH); s.commonHash = b ? b.hash : null; }
      catch (_) { s.commonHash = null; }
    }));
    const majorityHash = mode(states.filter((s) => s.ok).map((s) => s.commonHash).filter(Boolean));
    for (const s of states) {
      if (!s.ok) s.status = "down";
      else if (s.commonHash && majorityHash && s.commonHash !== majorityHash) s.status = "fork";
      else if (maxH - s.height > 2) s.status = "behind";
      else s.status = "sync";
      delete s.commonHash;
    }
    const inSync = states.length > 0 && states.every((s) => s.status === "sync");
    return { states, commonH, maxH, inSync, reachable: reachable.length, total: states.length };
  }

  async function compareAcrossNodes(kind, id) {
    const per = await Promise.all(nodes.map(async (n) => {
      try {
        const c = new ethers.Contract(cfg.addresses.Compliance, abis.Compliance, n.provider);
        const rec = kind === "spend" ? await c.getSpendRequest(BigInt(id)) : await c.getRecord(BigInt(id));
        return { label: n.label, ok: true, fingerprint: recordFingerprint(kind, rec) };
      } catch (_) { return { label: n.label, ok: false, fingerprint: null }; }
    }));
    // Reference = the main provider's view.
    const c = new ethers.Contract(cfg.addresses.Compliance, abis.Compliance, provider);
    const ref = kind === "spend" ? await c.getSpendRequest(BigInt(id)) : await c.getRecord(BigInt(id));
    const reference = recordFingerprint(kind, ref);
    return {
      per: per.map((p) => ({ label: p.label, ok: p.ok })),
      total: nodes.length,
      reachable: per.filter((x) => x.ok).length,
      agree: per.filter((x) => x.ok && x.fingerprint === reference).length,
    };
  }

  function hasHash(h) { return !!h && !/^0x0{64}$/.test(h); }

  async function getIntegrity(kind, id) {
    try {
      if (kind === "spend") {
        const r = await read.compliance.getSpendRequest(BigInt(id));
        if (r.id === 0n) return { ok: false, label: "Not on ledger", detail: "No such spend request.", nodes: null };
        const base = {
          ok: true,
          locked: r.approved,
          documentHash: r.documentHash,
          hasDocument: hasHash(r.documentHash),
          label: r.approved ? "On ledger · approved" : "On ledger · pending",
          detail: r.approved
            ? "Approved 2-of-3 and recorded immutably on the ledger."
            : "Recorded on the ledger; awaiting 2-of-3 approval.",
        };
        base.nodes = await compareAcrossNodes("spend", id);
        return base;
      }
      const rec = await read.compliance.getRecord(BigInt(id));
      if (rec.id === 0n) return { ok: false, label: "Not on ledger", detail: "No such record.", nodes: null };
      const base = {
        ok: true,
        locked: rec.finalised,
        documentHash: rec.documentHash,
        hasDocument: hasHash(rec.documentHash),
        label: rec.finalised ? "On ledger · finalised" : "On ledger · pending",
        detail: rec.finalised
          ? "Finalised 2-of-3 and recorded immutably on the ledger."
          : "Recorded on the ledger; awaiting 2-of-3 endorsement.",
      };
      base.nodes = await compareAcrossNodes("record", id);
      return base;
    } catch (err) {
      return { ok: false, label: "Unverifiable", detail: revertReason(err), nodes: null };
    }
  }

  async function health() {
    try {
      const block = await provider.getBlockNumber();
      const net = await provider.getNetwork();
      return { ok: true, chainId: net.chainId.toString(), block, addresses: cfg.addresses };
    } catch (err) {
      return { ok: false, chain: false, error: revertReason(err), addresses: cfg.addresses };
    }
  }

  // ----------------------------------------------------------------- WRITES
  async function createAgreement(role, startDate, endDate, signatories) {
    const c = writeContract("Agreement", signerFor(role));
    const { tx, receipt } = await send(c.createAgreement(BigInt(startDate), BigInt(endDate), signatories));
    const id = eventArg(receipt, c, "AgreementCreated", "id");
    return { hash: tx.hash, blockNumber: receipt.blockNumber, id: id != null ? id.toString() : null };
  }
  async function addTarget(role, id, indicator, threshold, unit, deadline) {
    const c = writeContract("Agreement", signerFor(role));
    const { tx, receipt } = await send(c.addTarget(BigInt(id), indicator, BigInt(threshold), unit, BigInt(deadline)));
    return { hash: tx.hash, blockNumber: receipt.blockNumber };
  }
  async function finaliseAgreement(role, id) {
    const c = writeContract("Agreement", signerFor(role));
    const { tx, receipt } = await send(c.finaliseAgreement(BigInt(id)));
    return { hash: tx.hash, blockNumber: receipt.blockNumber };
  }
  // --- draft editing (creator only; reverts on a finalised agreement) ---
  async function editTarget(role, id, index, indicator, threshold, unit, deadline) {
    const c = writeContract("Agreement", signerFor(role));
    const { tx, receipt } = await send(
      c.editTarget(BigInt(id), BigInt(index), indicator, BigInt(threshold), unit, BigInt(deadline)));
    return { hash: tx.hash, blockNumber: receipt.blockNumber };
  }
  async function removeTarget(role, id, index) {
    const c = writeContract("Agreement", signerFor(role));
    const { tx, receipt } = await send(c.removeTarget(BigInt(id), BigInt(index)));
    return { hash: tx.hash, blockNumber: receipt.blockNumber };
  }
  async function updateDates(role, id, startDate, endDate) {
    const c = writeContract("Agreement", signerFor(role));
    const { tx, receipt } = await send(c.updateDates(BigInt(id), BigInt(startDate), BigInt(endDate)));
    return { hash: tx.hash, blockNumber: receipt.blockNumber };
  }
  async function setBudget(role, id, amount) {
    const c = writeContract("Agreement", signerFor(role));
    const { tx, receipt } = await send(c.setBudget(BigInt(id), BigInt(amount)));
    return { hash: tx.hash, blockNumber: receipt.blockNumber };
  }
  async function registerOrg(address, orgType, name) {
    const c = writeContract("Agreement", ownerSigner());
    const { tx, receipt } = await send(c.registerOrganisation(address, Number(orgType), name));
    return { hash: tx.hash, blockNumber: receipt.blockNumber };
  }
  async function submitReport(role, agreementId, targetIndex, value, documentHash) {
    const c = writeContract("Compliance", signerFor(role));
    const call = documentHash
      ? c["submitReport(uint256,uint256,uint256,bytes32)"](BigInt(agreementId), BigInt(targetIndex), BigInt(value), documentHash)
      : c["submitReport(uint256,uint256,uint256)"](BigInt(agreementId), BigInt(targetIndex), BigInt(value));
    const { tx, receipt } = await send(call);
    const recordId = eventArg(receipt, c, "RecordSubmitted", "recordId");
    const result = eventArg(receipt, c, "RecordEvaluated", "result");
    return {
      hash: tx.hash,
      blockNumber: receipt.blockNumber,
      recordId: recordId != null ? recordId.toString() : null,
      result: result != null ? Number(result) : null,
    };
  }
  async function createSpendRequest(role, agreementId, amount, purpose, documentHash) {
    const c = writeContract("Compliance", signerFor(role));
    const { tx, receipt } = await send(
      c.createSpendRequest(BigInt(agreementId), BigInt(amount), purpose, documentHash || ethers.ZeroHash)
    );
    const requestId = eventArg(receipt, c, "SpendRequested", "requestId");
    return { hash: tx.hash, blockNumber: receipt.blockNumber, requestId: requestId != null ? requestId.toString() : null };
  }
  async function markSpent(role, id, receiptHash) {
    const c = writeContract("Compliance", signerFor(role));
    const { tx, receipt } = await send(c.markSpent(BigInt(id), receiptHash));
    return { hash: tx.hash, blockNumber: receipt.blockNumber };
  }
  async function endorseRecord(role, id) {
    const c = writeContract("Verification", signerFor(role));
    const { tx, receipt } = await send(c.endorse(BigInt(id)));
    return { hash: tx.hash, blockNumber: receipt.blockNumber };
  }
  async function declineRecord(role, id) {
    const c = writeContract("Verification", signerFor(role));
    const { tx, receipt } = await send(c.decline(BigInt(id)));
    return { hash: tx.hash, blockNumber: receipt.blockNumber };
  }
  async function markRecordUnverified(role, id) {
    const c = writeContract("Verification", signerFor(role));
    const { tx, receipt } = await send(c.markUnverified(BigInt(id)));
    return { hash: tx.hash, blockNumber: receipt.blockNumber };
  }
  async function endorseSpend(role, id) {
    const c = writeContract("Verification", signerFor(role));
    const { tx, receipt } = await send(c.endorseSpend(BigInt(id)));
    return { hash: tx.hash, blockNumber: receipt.blockNumber };
  }
  async function declineSpend(role, id) {
    const c = writeContract("Verification", signerFor(role));
    const { tx, receipt } = await send(c.declineSpend(BigInt(id)));
    return { hash: tx.hash, blockNumber: receipt.blockNumber };
  }

  return {
    // reads
    getAgreements, getRecords, getSpend, orgOf, hasFailingRecords,
    recentBlocks, agreementEvents, getNodeStates, getIntegrity, health,
    // writes
    createAgreement, addTarget, finaliseAgreement, setBudget, registerOrg,
    editTarget, removeTarget, updateDates,
    submitReport, createSpendRequest, markSpent,
    endorseRecord, declineRecord, markRecordUnverified, endorseSpend, declineSpend,
  };
}

module.exports = { makeChain, ApiError, revertReason };
