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

  // -------------------------------------------------- role switcher
  function renderRolebar() {
    const host = document.getElementById("macl-rolebar");
    if (!host) return;
    const active = MACL.getRole();
    host.innerHTML =
      `<span style="font-size:11px;color:#3f4947;align-self:center;margin-right:6px">Acting as</span>`;
    for (const [role, meta] of Object.entries(cfg.ROLES)) {
      const on = role === active;
      const btn = document.createElement("button");
      btn.textContent = meta.label;
      btn.title = meta.address;
      btn.style.cssText =
        "font-size:12px;font-weight:600;padding:6px 12px;border-radius:9999px;cursor:pointer;" +
        "transition:all .15s;border:1px solid " + (on ? "#00322d" : "#bfc9c6") + ";" +
        "background:" + (on ? "#00322d" : "#fff") + ";color:" + (on ? "#fff" : "#515f74");
      btn.onclick = () => switchRole(role);
      host.appendChild(btn);
    }
  }

  function switchRole(role) {
    MACL.setRole(role);
    applyPermissions(); // live-update the controls for the new role…
    MACL.toast("Acting as " + MACL.roleMeta(role).label,
      MACL.shortAddr(MACL.roleMeta(role).address), "info");
    // …then reload so every table/metric re-reads the chain as the new signer
    // (the reload re-runs boot() → applyPermissions() again on the fresh page).
    setTimeout(() => location.reload(), 350);
  }

  // Wire the Stitch role-switcher modal (index.html) if it exists.
  function wireRoleModal() {
    const modal = document.getElementById("role-switcher-modal");
    if (!modal) return;
    // Open it from any nav/header element labelled "Role Switcher".
    document.querySelectorAll("a, div, button").forEach((el) => {
      if (el.children.length === 0 && el.textContent.trim() === "Role Switcher") {
        el.style.cursor = "pointer";
        el.addEventListener("click", () => modal.classList.toggle("hidden"));
      }
    });
    window.toggleRoleSwitcher = () => modal.classList.toggle("hidden");
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
        text = `contracts missing: ${missing.join(", ")} — run deploy:local`;
      } else {
        dot = "#2ecc71";
        text = `connected · block #${block}`;
      }
    } catch (_) {
      dot = "#ba1a1a";
      text = "node unreachable @ " + cfg.RPC_URL;
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
    "record.endorse":      "This role cannot endorse records.",
    "record.decline":      "This role cannot decline records.",
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
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  // -------------------------------------------------- boot
  async function boot() {
    injectPrintStyles();
    injectPermStyles();
    installPermGuards();
    renderRolebar();
    wireRoleModal();
    try {
      await MACL.loadAbis();
    } catch (err) {
      MACL.toast("Could not load ABIs", MACL.parseError(err), "err");
    }
    await healthCheck();
    setInterval(healthCheck, 10000);
    booted = true;
    readyQueue.forEach(runSafe);
    applyPermissions(); // gate the static write controls present on load
  }

  document.addEventListener("DOMContentLoaded", boot);

  return { ready, switchRole, exportCSV, exportPDF, healthCheck, applyPermissions };
})();
