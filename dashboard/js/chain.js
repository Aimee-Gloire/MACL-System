/*
 * MACL Dashboard — chain.js  (three-tier: browser → REST API → Besu)
 * ------------------------------------------------------------------
 * The browser NO LONGER talks to the chain or holds any private keys. This file
 * is now a thin client over the Tier-2 REST API (api/), which holds the signer
 * keys server-side, signs every transaction, and proxies the cross-node
 * integrity reads (the validators' JSON-RPC is never exposed to the browser).
 *
 * The public surface (window.MACL) is unchanged so the page views keep working:
 *   contracts(role)         per-action write handles (each POSTs to the API)
 *   fetchAgreements/Records/SpendRequests   reads (GET the API)
 *   verifyRecord/getNodeStates              integrity (proxied by the API)
 *   login/logout/isLoggedIn/getRole         session state (BL-13; role from JWT)
 *   withTx, toast, formatting helpers       unchanged
 */
window.MACL = (function () {
  const cfg = window.MACL_CONFIG;
  const ROLE_KEY = "macl.role";     // the logged-in org's role
  const TOKEN_KEY = "macl.token";   // the session JWT
  const API = cfg.API_BASE;         // e.g. "http://127.0.0.1:3001/api"

  // -------------------------------------------------- session (BL-13)
  function token() { return localStorage.getItem(TOKEN_KEY); }
  function isLoggedIn() { return !!token(); }
  function authHeaders(extra) {
    const t = token();
    return Object.assign({}, extra || {}, t ? { authorization: `Bearer ${t}` } : {});
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
  }
  // On any 401, the session is gone/expired — drop it and bounce to login.
  function onUnauthorized() {
    clearSession();
    if (!/login\.html$/.test(location.pathname)) location.href = "login.html";
  }

  // -------------------------------------------------- HTTP helpers
  async function apiError(res) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_) {}
    const e = new Error(msg);
    e.shortMessage = msg;
    return e;
  }
  async function apiGet(path) {
    const res = await fetch(API + path, { headers: authHeaders() });
    if (res.status === 401) onUnauthorized();
    if (!res.ok) throw await apiError(res);
    return res.json();
  }
  async function apiPost(path, body) {
    const res = await fetch(API + path, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(body || {}),
    });
    if (res.status === 401) onUnauthorized();
    if (!res.ok) throw await apiError(res);
    return res.json();
  }
  // POST a raw file body (binary) — used for the document store.
  async function apiPostFile(path, file) {
    const res = await fetch(API + path, {
      method: "POST",
      headers: authHeaders({ "content-type": file.type || "application/octet-stream" }),
      body: file,
    });
    if (res.status === 401) onUnauthorized();
    if (!res.ok) throw await apiError(res);
    return res.json();
  }

  // Log in with org credentials → store the JWT + role. Uses a bare fetch so a
  // 401 here (bad password) surfaces to the login form instead of redirecting.
  async function login(username, password) {
    const res = await fetch(API + "/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw await apiError(res);
    const data = await res.json();
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(ROLE_KEY, data.role);
    return data;
  }
  function logout() { clearSession(); location.href = "login.html"; }

  // -------------------------------------------------- write handles
  // Returns objects whose methods mirror the original contract-call shape but POST
  // to the API. Each returns a "pseudo-tx" { hash, blockNumber, …, wait() } so
  // the existing `withTx(label, () => handle.method(...))` call sites keep working.
  function postTx(path, body) {
    return apiPost(path, body).then((res) => ({ ...res, wait: async () => res }));
  }
  function contracts(role) {
    const needRole = () => { if (!role) throw new Error("No acting role — sign-in required for writes"); return role; };
    return {
      agreement: {
        createAgreement: (startDate, endDate, signatories) =>
          postTx("/agreements", { role: needRole(), startDate: String(startDate), endDate: String(endDate), signatories }),
        addTarget: (id, indicator, threshold, unit, deadline) =>
          postTx(`/agreements/${id}/targets`, { role: needRole(), indicator, threshold: String(threshold), unit, deadline: String(deadline) }),
        finaliseAgreement: (id) =>
          postTx(`/agreements/${id}/finalise`, { role: needRole() }),
        setBudget: (id, amount) =>
          postTx(`/agreements/${id}/budget`, { role: needRole(), amount: String(amount) }),
      },
      compliance: {
        submitReport: (id, idx, val) =>
          postTx("/reports", { role: needRole(), agreementId: String(id), targetIndex: String(idx), value: String(val) }),
        "submitReport(uint256,uint256,uint256,bytes32)": (id, idx, val, documentHash) =>
          postTx("/reports", { role: needRole(), agreementId: String(id), targetIndex: String(idx), value: String(val), documentHash }),
        createSpendRequest: (id, amount, purpose, documentHash) =>
          postTx("/spend", { role: needRole(), agreementId: String(id), amount: String(amount), purpose, documentHash: documentHash || null }),
        markSpent: (id, receiptHash) =>
          postTx(`/spend/${id}/spent`, { role: needRole(), receiptHash }),
      },
      verification: {
        endorse: (id) => postTx(`/records/${id}/endorse`, { role: needRole() }),
        decline: (id) => postTx(`/records/${id}/decline`, { role: needRole() }),
        markUnverified: (id) => postTx(`/records/${id}/expire`, { role: needRole() }),
        endorseSpend: (id) => postTx(`/spend/${id}/endorse`, { role: needRole() }),
        declineSpend: (id) => postTx(`/spend/${id}/decline`, { role: needRole() }),
      },
    };
  }

  // -------------------------------------------------- role state (from the session)
  // The acting role is whatever org is LOGGED IN (set by login()); there is no
  // in-browser switcher any more — acting as another org means logging in as it.
  function getRole() {
    const saved = localStorage.getItem(ROLE_KEY);
    return cfg.ROLES[saved] ? saved : null;
  }
  function roleMeta(role) { return cfg.ROLES[role || getRole()] || null; }

  // UI gating: mirrors the on-chain role rules so a denied control is greyed out
  // before the user triggers a request the contract (and the API) would reject.
  function can(actionKey, role) {
    const perms = (cfg.PERMISSIONS && cfg.PERMISSIONS[role || getRole()]) || [];
    return perms.includes(actionKey);
  }

  function metaForAddress(addr) {
    const hit = Object.values(cfg.ROLES).find((r) => r.address.toLowerCase() === String(addr).toLowerCase());
    return hit || { label: shortAddr(addr), short: "?", address: addr };
  }

  async function hasFailingRecords(agreementId) {
    try { const r = await apiGet(`/agreements/${agreementId}/failing`); return !!r.hasFailing; }
    catch (_) { return false; }
  }

  // -------------------------------------------------- health checks (via API)
  async function ping() {
    const h = await apiGet("/health");
    if (!h.ok) throw new Error(h.error || "chain unreachable");
    return h.block;
  }
  async function getChainId() { return (await apiGet("/health")).chainId; }
  async function verifyDeployed() {
    const h = await apiGet("/health").catch(() => ({ ok: false }));
    const ok = !!h.ok;
    return { Agreement: ok, Compliance: ok, Verification: ok };
  }

  // -------------------------------------------------- formatting helpers
  function shortAddr(a) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—"; }
  function labelForAddress(addr) {
    if (!addr) return "—";
    const hit = Object.values(cfg.ROLES).find((r) => r.address.toLowerCase() === addr.toLowerCase());
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
  function hasHash(h) { return !!h && !/^0x0{64}$/.test(h); }
  function fmtMoney(v) {
    try { return `${BigInt(v).toLocaleString("en-US")} ${cfg.MONEY_UNIT}`; }
    catch (_) { return `${v} ${cfg.MONEY_UNIT}`; }
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
      (err && err.shortMessage) ||
      (err && err.reason) ||
      (err && err.message) ||
      String(err)
    );
  }

  // Run a state-changing call through the API: send, surface each step, toast.
  // `fn` returns the pseudo-tx promise (from a contracts(role) handle).
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

  // -------------------------------------------------- high-level fetchers (API)
  async function fetchAgreements() {
    const rows = await apiGet("/agreements");
    for (const r of rows) {
      // money fields come as decimal strings; views compare them with BigInt.
      r.budget = BigInt(r.budget);
      r.committed = BigInt(r.committed);
      r.remaining = BigInt(r.remaining);
      r.a.budget = BigInt(r.a.budget);
      r.a.committedSpend = BigInt(r.a.committedSpend);
    }
    return rows;
  }

  async function fetchSpendRequests(forAddr) {
    const rows = await apiGet("/spend");
    const acting = (forAddr || "").toLowerCase();
    for (const r of rows) {
      r.endorsedByActing = !!acting && (r.endorsers || []).some((a) => a.toLowerCase() === acting);
      r.declinedByActing = !!acting && (r.decliners || []).some((a) => a.toLowerCase() === acting);
    }
    return rows;
  }

  async function fetchRecords(forAddr) {
    const rows = await apiGet("/records");
    const acting = (forAddr || "").toLowerCase();
    for (const r of rows) {
      const eAddrs = r.endorsers || [];
      const dAddrs = r.decliners || [];
      r.endorsedByActing = !!acting && eAddrs.some((a) => a.toLowerCase() === acting);
      r.declinedByActing = !!acting && dAddrs.some((a) => a.toLowerCase() === acting);
      // Audit view expects role-meta objects, not raw addresses.
      r.endorsers = eAddrs.map(metaForAddress);
      r.decliners = dAddrs.map(metaForAddress);
    }
    return rows;
  }

  // Recent blocks (number + tx count), for the Reports page strip.
  async function recentBlocks(n) { return apiGet(`/blocks/recent?n=${n || 3}`); }

  // Recent agreement lifecycle events, for the Agreements page ledger timeline.
  async function fetchAgreementEvents(limit) { return apiGet(`/events/agreements?limit=${limit || 6}`); }

  // -------------------------------------------------- documents (BL-12 / BL-14)
  // The file's SHA-256 is computed SERVER-SIDE by the API (works over plain http
  // on a real domain — no browser crypto.subtle). uploadDocument STORES the file
  // and returns the hash to put on-chain; verifyStoredDocument re-hashes the
  // STORED file server-side and compares to the on-chain hash (one-click verify).

  // Store a file in the document store; returns { hash, size, contentType, filename, existed }.
  async function uploadDocument(file) {
    return apiPostFile(`/documents/upload?filename=${encodeURIComponent(file.name || "file")}`, file);
  }
  // Direct URL to download a stored file (the on-chain hash is the key). The
  // session token rides as a query param so a plain <a href> download is
  // authenticated (a link navigation can't set an Authorization header).
  function documentUrl(hash) {
    const t = token();
    return `${API}/documents/${hash}${t ? `?token=${encodeURIComponent(t)}` : ""}`;
  }
  // Ask the server to re-hash the STORED file and compare to the on-chain hash.
  async function verifyStoredDocument(hash) {
    try { return await apiGet(`/documents/${hash}/verify`); }
    catch (_) { return { stored: false, match: false }; }
  }

  // -------------------------------------------------- integrity (proxied by API)
  async function getNodeStates() { return apiGet("/nodes"); }

  // The ONE place the integrity badge calls. The API confirms the record/request
  // is on the ledger and runs the cross-node comparison server-side, returning
  // { ok, locked, label, detail, documentHash, hasDocument, nodes:{agree,total,…} }.
  async function verifyRecord(ref) {
    try { return await apiGet(`/integrity/${ref.kind}/${ref.id}`); }
    catch (err) { return { ok: false, label: "Unverifiable", detail: parseError(err), nodes: null }; }
  }

  return {
    cfg,
    contracts,
    login, logout, isLoggedIn,
    getRole, roleMeta, can, hasFailingRecords,
    ping, getChainId, verifyDeployed,
    shortAddr, labelForAddress, fmtResult, fmtTs, toUnix, fmtHash, hasHash, fmtMoney, esc,
    toast, parseError, withTx,
    fetchAgreements, fetchRecords, fetchSpendRequests, recentBlocks, fetchAgreementEvents,
    verifyRecord,
    uploadDocument, documentUrl, verifyStoredDocument,
    getNodeStates,
  };
})();
