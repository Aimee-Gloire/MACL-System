/*
 * MACL Dashboard — ui.js
 * ------------------------------------------------------------------
 * Shared chrome for every page. It:
 *   - boots the app (load ABIs, health-check the node)
 *   - builds the persisted role switcher (#macl-rolebar + the modal)
 *   - drives the live connection light (#macl-conn)
 *   - exports the on-screen ledger to CSV / PDF
 *   - lets each page register its data loader via MACL_UI.ready(fn)
 *
 * Markup hooks a page can include (all optional):
 *   <div id="macl-rolebar"></div>   role pill buttons get rendered here
 *   <span id="macl-conn"></span>    connection dot + text get rendered here
 *   #role-switcher-modal            the Stitch role modal (wired if present)
 */
window.MACL_UI = (function () {
  const cfg = window.MACL_CONFIG;
  const readyQueue = [];
  let booted = false;

  // -------------------------------------------------- ready queue
  // Pages call MACL_UI.ready(async () => {...}) to load their data once
  // the shared boot (ABIs) has finished.
  function ready(fn) {
    if (booted) runSafe(fn);
    else readyQueue.push(fn);
  }
  async function runSafe(fn) {
    try { await fn(); }
    catch (err) { MACL.toast("Load error", MACL.parseError(err), "err"); }
  }

  // -------------------------------------------------- session bar (BL-13)
  // Replaces the old "acting as" switcher: shows the LOGGED-IN org + a Sign out
  // button. Acting as another org now means signing out and signing in as it.
  function renderSessionBar() {
    const host = document.getElementById("macl-rolebar");
    if (!host) return;
    const meta = MACL.roleMeta();
    host.innerHTML = "";
    const label = document.createElement("span");
    label.style.cssText = "font-size:12px;color:#3f4947;align-self:center;margin-right:8px";
    label.innerHTML = `Signed in as <b style="color:#00322d">${MACL.esc(meta ? meta.label : "—")}</b>`;
    label.title = meta ? meta.address : "";
    const out = document.createElement("button");
    out.textContent = "Sign out";
    out.style.cssText =
      "font-size:12px;font-weight:600;padding:6px 12px;border-radius:9999px;cursor:pointer;" +
      "border:1px solid #bfc9c6;background:#fff;color:#515f74";
    out.onclick = () => MACL.logout();
    host.append(label, out);
  }

  // -------------------------------------------------- connection light
  async function healthCheck() {
    const host = document.getElementById("macl-conn");
    let dot = "#f1c40f", text = "connecting…";
    try {
      const block = await MACL.ping();
      const deployed = await MACL.verifyDeployed();
      const missing = Object.entries(deployed).filter(([, ok]) => !ok).map(([n]) => n);
      if (missing.length) {
        dot = "#ba1a1a";
        text = `contracts missing: ${missing.join(", ")} — run deploy:besu`;
      } else {
        dot = "#2ecc71";
        text = `connected · block #${block}`;
      }
    } catch (_) {
      dot = "#ba1a1a";
      text = "API unreachable @ " + cfg.API_BASE;
    }
    if (host) {
      host.innerHTML =
        `<span style="width:9px;height:9px;border-radius:50%;background:${dot};` +
        `display:inline-block;margin-right:6px"></span>` +
        `<span style="font-size:11px;color:#3f4947;font-family:'JetBrains Mono',monospace">${MACL.esc(text)}</span>`;
      host.style.cssText = "display:inline-flex;align-items:center";
    }
    return dot === "#2ecc71";
  }

  // -------------------------------------------------- exports
  // rows: array of arrays (cells). header: array of column titles.
  function exportCSV(filename, header, rows) {
    const escCell = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.map(escCell).join(",")]
      .concat(rows.map((r) => r.map(escCell).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    MACL.toast("Export ready", `${filename} (${rows.length} rows)`, "ok");
  }

  // Browser "Save as PDF". A print stylesheet (injected below) hides the
  // sidebar/header chrome so only the ledger content prints.
  function exportPDF() { window.print(); }

  // -------------------------------------------------- secure document view (F-07)
  // Fetch the stored evidence file WITH the auth header (no token in any URL) and
  // save it via a Blob. We never point the browser AT the file, so a malicious
  // upload can't run script in our origin; combined with the server's
  // attachment + nosniff + type allow-list (F-06), this closes the stored-XSS hole.
  async function viewDoc(hash) {
    try {
      const { blob, filename } = await MACL.fetchDocumentBlob(hash);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      MACL.toast("Could not open document", MACL.parseError(err), "err");
    }
  }

  // -------------------------------------------------- one-click verify (BL-14)
  // Shared by Reports / Budget & Spend / Audit Trail. A "Verify" button carries
  // data-verify-stored="<on-chain hash>" and data-out="<result span id>". On
  // click, the API fetches the STORED file and re-hashes it server-side against
  // that hash — no file picking, no browser hashing, no chain/storage access here.
  function renderVerifyResult(out, v) {
    let text, title, color;
    if (!v || !v.stored) {
      text = "No stored copy"; color = "#515f74";
      title = "No file is stored for this fingerprint (nothing was uploaded for it).";
    } else if (v.match) {
      text = "✓ Verified"; color = "#15803d";
      title = "Unchanged since recorded — not proof of authenticity.";
    } else {
      text = "✗ Not verified"; color = "#ba1a1a";
      title = "The stored file does not match the on-chain hash.";
    }
    out.textContent = text; out.title = title; out.style.color = color;
  }
  function wireVerify(root) {
    (root || document).querySelectorAll("button[data-verify-stored]").forEach((b) => {
      if (b.dataset.wired) return;
      b.dataset.wired = "1";
      b.addEventListener("click", async (e) => {
        e.stopPropagation();
        const hash = b.getAttribute("data-verify-stored");
        const out = document.getElementById(b.getAttribute("data-out"));
        if (out) { out.textContent = "Checking…"; out.style.color = "#515f74"; out.title = ""; }
        try {
          const v = await MACL.verifyStoredDocument(hash);
          if (out) renderVerifyResult(out, v);
        } catch (err) {
          if (out) { out.textContent = MACL.parseError(err); out.style.color = "#ba1a1a"; }
        }
      });
    });
  }

  // -------------------------------------------------- plain-language glossary (BL-15)
  // Any element with data-help="<key>" gets a hover tooltip explaining the term in
  // plain language — so non-technical users aren't blocked by blockchain jargon.
  const GLOSSARY = {
    endorse: "Endorse = formally agree this record is correct. Two of the three organisations must endorse before it is finalised (2-of-3).",
    decline: "Decline = formally dispute this record. Enough declines stop it ever reaching the 2-of-3 needed to finalise.",
    finalise: "Finalise = lock the record permanently once 2 of 3 organisations have endorsed it. It can't be changed afterwards.",
    blockhash: "Block hash = the fingerprint of the blockchain block that locked this record — proof of exactly when it was finalised.",
    "2of3": "2-of-3 = at least two of the three organisations (NGO, Government, Donor) must agree before anything is finalised or approved.",
    endorsement: "Endorsement = one organisation's formal agreement. Two of three are needed to finalise a record or approve a spend.",
    pass: "PASS = the reported value met the target on time.",
    fail: "FAIL = the reported value was below the agreed target.",
    flag: "FLAG = the target was met but reported after the deadline — needs a human to review.",
    pending: "Pending = recorded on the ledger but not yet finalised (still waiting for 2 of 3 to endorse).",
    integrity: "Integrity check = each of the three nodes is asked for this record and the copies are compared. 'Verified across 3 nodes' means all agree.",
    expired: "Window passed = the verification window elapsed before 2 of 3 endorsed. The record can no longer be finalised; a signatory should mark it Unverified.",
    unverified: "Unverified = a terminal state. The verification window passed without 2-of-3 endorsement, so the record was closed as unverified instead of finalised.",
  };
  function injectGlossaryStyles() {
    const style = document.createElement("style");
    style.textContent = "[data-help]{cursor:help}";
    document.head.appendChild(style);
  }
  function tip(el) {
    const k = el.getAttribute && el.getAttribute("data-help");
    if (k && GLOSSARY[k] && !el.title) el.title = GLOSSARY[k];
  }
  function applyGlossary(root) {
    const scope = root || document;
    if (scope.nodeType === 1 && scope.hasAttribute && scope.hasAttribute("data-help")) tip(scope);
    if (scope.querySelectorAll) scope.querySelectorAll("[data-help]").forEach(tip);
  }

  // Print the ENTIRE current page (all cards/tables as shown), dropping
  // only the fixed nav rail and interactive-only controls (buttons,
  // role switcher) that don't belong on paper.
  function injectPrintStyles() {
    const style = document.createElement("style");
    style.media = "print";
    style.textContent =
      "aside{display:none!important} main{margin-left:0!important;max-width:none!important} " +
      ".no-print,#macl-rolebar,#macl-conn,button{display:none!important} " +
      "body{background:#fff!important} " +
      "* {-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}";
    document.head.appendChild(style);
  }

  // -------------------------------------------------- permissions (UI gating)
  // Why these exist: the contracts only gate by `creator`, so the dashboard
  // enforces the real-world division of duties itself. Gating is per ACTION
  // (config.PERMISSIONS), never per page — every role still SEES every page.
  const PERM_MSG = {
    "agreement.create":    "Only the Donor-Admin can create agreements.",
    "agreement.addTarget": "Only the Donor-Admin can add targets.",
    "agreement.finalise":  "Only the Donor-Admin can finalise (lock) agreements.",
    "report.submit":       "Only the NGO can submit reports.",
    "budget.set":          "Only the Donor-Admin can set an agreement's budget.",
    "spend.request":       "Only the NGO can raise a spend request.",
    "record.endorse":      "This role cannot endorse records.",
    "record.decline":      "This role cannot decline records.",
    "spend.endorse":       "This role cannot approve spend requests.",
    "spend.decline":       "This role cannot decline spend requests.",
  };

  function injectPermStyles() {
    const style = document.createElement("style");
    style.textContent =
      ".perm-denied{opacity:.5!important;cursor:not-allowed!important;filter:grayscale(35%)}";
    document.head.appendChild(style);
  }

  // Apply or clear gating for ONE tagged control, based on the acting role.
  function gateOne(el) {
    const perm = el.getAttribute("data-perm");
    if (!perm) return;
    const allowed = MACL.can(perm);
    const hideMode = cfg.PERMISSION_MODE === "hide";
    if (allowed) {
      el.classList.remove("perm-denied");
      el.removeAttribute("aria-disabled");
      if (el.dataset.permHidden) { el.style.display = el.dataset.permPrev || ""; delete el.dataset.permHidden; delete el.dataset.permPrev; }
      if (el.dataset.permTitled) { el.removeAttribute("title"); delete el.dataset.permTitled; }
    } else if (hideMode) {
      if (!el.dataset.permHidden) { el.dataset.permPrev = el.style.display; el.dataset.permHidden = "1"; }
      el.style.display = "none";
    } else {
      el.classList.add("perm-denied");
      el.setAttribute("aria-disabled", "true");
      el.title = PERM_MSG[perm] || "You do not have permission for this action.";
      el.dataset.permTitled = "1";
    }
  }

  // Re-gate every tagged control. Called on load and after every role change.
  function applyPermissions(root) {
    (root || document).querySelectorAll("[data-perm]").forEach(gateOne);
  }

  // Block the ACTION on denied controls even if clicked or keyboard-submitted.
  // (We use capture-phase guards instead of pointer-events:none so the
  // explanatory tooltip still shows on hover.) The MutationObserver gates
  // controls the view scripts render later (finalise / endorse / decline).
  function installPermGuards() {
    document.addEventListener("click", (e) => {
      const el = e.target.closest && e.target.closest('[data-perm][aria-disabled="true"]');
      if (el) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    document.addEventListener("submit", (e) => {
      const perm = e.target && e.target.getAttribute && e.target.getAttribute("data-perm");
      if (perm && !MACL.can(perm)) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches && n.matches("[data-perm]")) gateOne(n);
        if (n.querySelectorAll) n.querySelectorAll("[data-perm]").forEach(gateOne);
        // Plain-language tooltips on any dynamically-rendered jargon (BL-15).
        applyGlossary(n);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  // -------------------------------------------------- boot
  async function boot() {
    // BL-13: every page requires a session. If not signed in, go to the login page.
    if (!MACL.isLoggedIn()) { location.href = "login.html"; return; }
    injectPrintStyles();
    injectPermStyles();
    injectGlossaryStyles();
    installPermGuards();
    renderSessionBar();
    await healthCheck();
    setInterval(healthCheck, 10000);
    booted = true;
    readyQueue.forEach(runSafe);
    applyPermissions(); // gate the static write controls for the logged-in role
    applyGlossary();    // tooltip the static jargon present on load
  }

  document.addEventListener("DOMContentLoaded", boot);

  return { ready, exportCSV, exportPDF, healthCheck, applyPermissions, wireVerify, applyGlossary, viewDoc };
})();
