/*
 * MACL Dashboard — chain.js
 * ------------------------------------------------------------------
 * The bridge between the browser and the blockchain. There is NO API:
 * this file uses ethers.js to talk to the deployed contracts directly.
 *
 * Shared by every page. Exposes a single global, window.MACL, with:
 *   loadAbis()              fetch + cache the 3 contract ABIs
 *   contracts(role)         contract instances (signer-bound if role)
 *   getRole()/setRole()     which Hardhat account is "acting" (persisted)
 *   roleMeta(role)          {label,short,address,key} for a role
 *   withTx(label, fn)       send → wait → toast (surfaces revert reasons)
 *   fetchAgreements()       all agreements (+ targets), newest first
 *   fetchRecords()          all compliance records (+ target + endorsement state)
 *   helpers                 shortAddr, fmtResult, fmtTs, toUnix, fmtHash, esc…
 *   ping()/verifyDeployed() health checks for the connection light
 */
window.MACL = (function () {
  const cfg = window.MACL_CONFIG;
  const ROLE_KEY = "macl.role"; // localStorage key for the acting role

  // One read provider for the whole app (used for reads + event logs).
  const provider = new ethers.JsonRpcProvider(cfg.RPC_URL);

  let abis = null; // { Agreement, Compliance, Verification }

  // -------------------------------------------------- ABIs
  async function loadAbis() {
    if (abis) return abis;
    const names = Object.keys(cfg.ABI_PATHS);
    const loaded = await Promise.all(
      names.map(async (name) => {
        const res = await fetch(cfg.ABI_PATHS[name]);
        if (!res.ok) {
          throw new Error(
            `Could not load ABI for ${name} (HTTP ${res.status}). ` +
            `Are you serving from the repo root?`
          );
        }
        return [name, (await res.json()).abi];
      })
    );
    abis = Object.fromEntries(loaded);
    return abis;
  }

  // -------------------------------------------------- signers / contracts
  // Wrap the wallet in a NonceManager so back-to-back writes from the same
  // account (e.g. createAgreement → addTarget → addTarget) get sequential
  // nonces instead of racing and silently reverting the later txs.
  function signerFor(role) {
    const r = cfg.ROLES[role];
    if (!r) throw new Error(`Unknown role: ${role}`);
    return new ethers.NonceManager(new ethers.Wallet(r.key, provider));
  }

  // Pass a role for write-capable (signer-bound) contracts; pass nothing
  // for read-only (provider-bound) contracts.
  function contracts(role) {
    if (!abis) throw new Error("ABIs not loaded — call MACL.loadAbis() first");
    const runner = role ? signerFor(role) : provider;
    return {
      agreement: new ethers.Contract(cfg.ADDRESSES.Agreement, abis.Agreement, runner),
      compliance: new ethers.Contract(cfg.ADDRESSES.Compliance, abis.Compliance, runner),
      verification: new ethers.Contract(cfg.ADDRESSES.Verification, abis.Verification, runner),
    };
  }

  // -------------------------------------------------- role state (persisted)
  function getRole() {
    const saved = localStorage.getItem(ROLE_KEY);
    return cfg.ROLES[saved] ? saved : cfg.DEFAULT_ROLE;
  }
  function setRole(role) {
    if (!cfg.ROLES[role]) throw new Error(`Unknown role: ${role}`);
    localStorage.setItem(ROLE_KEY, role);
  }
  function roleMeta(role) { return cfg.ROLES[role || getRole()]; }

  // Can the given role (default: the acting role) perform this action?
  // Reads the PERMISSIONS map in config.js. UI-only — the chain still
  // enforces its own rules independently.
  function can(actionKey, role) {
    const perms = (cfg.PERMISSIONS && cfg.PERMISSIONS[role || getRole()]) || [];
    return perms.includes(actionKey);
  }

  // -------------------------------------------------- health checks
  async function ping() { return provider.getBlockNumber(); }
  async function getChainId() { return (await provider.getNetwork()).chainId; }
  async function verifyDeployed() {
    const out = {};
    for (const [name, addr] of Object.entries(cfg.ADDRESSES)) {
      const code = await provider.getCode(addr);
      out[name] = !!code && code !== "0x";
    }
    return out;
  }

  // -------------------------------------------------- formatting helpers
  function shortAddr(a) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—"; }
  function labelForAddress(addr) {
    if (!addr) return "—";
    const hit = Object.values(cfg.ROLES).find(
      (r) => r.address.toLowerCase() === addr.toLowerCase()
    );
    return hit ? hit.label : shortAddr(addr);
  }
  function fmtResult(n) { return cfg.RESULT_LABELS[Number(n)] || "PENDING"; }
  function fmtTs(sec) {
    const n = Number(sec);
    if (!n) return "—";
    return new Date(n * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }
  function toUnix(localStr) {
    if (!localStr) return 0;
    return Math.floor(new Date(localStr).getTime() / 1000);
  }
  function fmtHash(h) {
    if (!h || /^0x0{64}$/.test(h)) return "—";
    return `${h.slice(0, 10)}…${h.slice(-6)}`;
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  // -------------------------------------------------- toasts
  function toast(title, body, kind = "info") {
    let stack = document.getElementById("macl-toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.id = "macl-toast-stack";
      stack.style.cssText =
        "position:fixed;right:24px;bottom:24px;z-index:200;display:flex;" +
        "flex-direction:column;gap:8px;max-width:380px;font-family:Inter,sans-serif";
      document.body.appendChild(stack);
    }
    const colors = { ok: "#00322d", err: "#ba1a1a", info: "#515f74" };
    const el = document.createElement("div");
    el.style.cssText =
      `background:#fff;border:1px solid #bfc9c6;border-left:4px solid ${colors[kind] || colors.info};` +
      "border-radius:4px;padding:12px 14px;box-shadow:0 6px 20px rgba(0,0,0,.12)";
    const t = document.createElement("div");
    t.style.cssText = "font-weight:600;font-size:14px;color:#191c1b";
    t.textContent = title;
    const b = document.createElement("div");
    b.style.cssText = "font-size:12px;color:#3f4947;margin-top:2px;word-break:break-word";
    b.textContent = body || "";
    el.append(t, b);
    stack.appendChild(el);
    setTimeout(() => el.remove(), kind === "err" ? 8000 : 4500);
  }

  function parseError(err) {
    return (
      (err && err.revert && err.revert.args && err.revert.args[0]) ||
      (err && err.reason) ||
      (err && err.shortMessage) ||
      (err && err.info && err.info.error && err.info.error.message) ||
      (err && err.message) ||
      String(err)
    );
  }

  // Run a state-changing call: send, wait for mining, toast each step,
  // surface revert reasons. `fn` returns the contract method promise.
  async function withTx(label, fn) {
    try {
      const tx = await fn();
      toast(label, `tx ${shortAddr(tx.hash)} submitted…`, "info");
      const receipt = await tx.wait();
      toast(`${label} ✓`, `mined in block #${receipt.blockNumber}`, "ok");
      return receipt;
    } catch (err) {
      toast(`${label} failed`, parseError(err), "err");
      throw err;
    }
  }

  // -------------------------------------------------- event helpers
  async function getLogs(contract, eventName) {
    return contract.queryFilter(contract.filters[eventName]());
  }

  // -------------------------------------------------- high-level fetchers
  // Every agreement (+ its targets), newest first. Shared by Overview,
  // Agreements, Reports.
  async function fetchAgreements() {
    const { agreement } = contracts();
    const logs = await getLogs(agreement, "AgreementCreated");
    const ids = [...new Set(logs.map((l) => l.args.id.toString()))];
    const rows = [];
    for (const idStr of ids) {
      const id = BigInt(idStr);
      const a = await agreement.getAgreement(id);
      const count = await agreement.targetCount(id);
      const targets = [];
      for (let i = 0n; i < count; i++) targets.push(await agreement.getTarget(id, i));
      rows.push({ id: idStr, a, targets, finalised: a.finalised });
    }
    rows.sort((x, y) => Number(y.id) - Number(x.id));
    return rows;
  }

  // Every compliance record (+ its target, endorsement count, finalised
  // block hash, and whether `forAddr` has endorsed it). Shared by
  // Overview, Audit, Node Status, Reports.
  async function fetchRecords(forAddr) {
    const { compliance, verification, agreement } = contracts();
    const logs = await getLogs(compliance, "RecordSubmitted");
    const ids = [...new Set(logs.map((l) => l.args.recordId.toString()))];
    const rows = [];
    for (const idStr of ids) {
      const id = BigInt(idStr);
      const rec = await compliance.getRecord(id);
      const t = await agreement.getTarget(rec.agreementId, rec.targetIndex);
      const count = await verification.endorsementCount(id);
      const declines = await verification.declineCount(id);
      const blockHash = await verification.finalisedBlockHash(id);
      const endorsedByActing = forAddr ? await verification.hasEndorsed(id, forAddr) : false;
      const declinedByActing = forAddr ? await verification.hasDeclined(id, forAddr) : false;
      rows.push({ rec, target: t, count, declines, blockHash, endorsedByActing, declinedByActing });
    }
    rows.sort((a, b) => Number(b.rec.id) - Number(a.rec.id));
    return rows;
  }

  return {
    provider, cfg,
    loadAbis, contracts, signerFor,
    getRole, setRole, roleMeta, can,
    ping, getChainId, verifyDeployed,
    shortAddr, labelForAddress, fmtResult, fmtTs, toUnix, fmtHash, esc,
    toast, parseError, withTx, getLogs,
    fetchAgreements, fetchRecords,
  };
})();
