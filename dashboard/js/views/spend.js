/*
 * Budget & Spend page — Part 1's contract logic, in the browser.
 *  - Donor sets a budget on a DRAFT agreement (locks at finalisation).
 *  - NGO raises a spend request (amount, purpose, supporting-document fingerprint).
 *    The document is uploaded to the server, which returns its SHA-256 — only that hash
 *    is recorded on-chain (the file itself never goes on the blockchain).
 *  - The two NON-submitter roles endorse/decline; a request is APPROVED at 2-of-3 and
 *    the remaining budget drops. The submitter cannot approve its own request.
 *  - After approval the requester can MARK IT SPENT (BL-7): the actual receipt is
 *    uploaded + hashed server-side and only its SHA-256 is pinned on-chain, closing the
 *    loop request -> approved (supporting doc) -> spent (receipt). The receipt is re-verifiable.
 *  - Spend is FLAGGED, not blocked, when the programme has a failing compliance
 *    record (BL-8) — the 2-of-3 approval still decides (deliberate decoupling).
 *  - Each request carries an integrity badge (MACL.verifyRecord) and one-click
 *    View / Verify on its stored document + receipt (BL-14, MACL.verifyStoredDocument).
 * Everything reads and writes through the Tier-2 REST API (api/) — the browser
 * holds no keys and never talks to the chain directly.
 */
MACL_UI.ready(async () => {
  const cfg = MACL.cfg;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  // Role scoping: show each write card only to the org that operates it. Other roles still
  // see both tables below and can endorse/decline spend; only the forms are hidden. When only
  // one form remains visible, it expands to fill the row.
  const canBudget = MACL.can("budget.set"), canSpend = MACL.can("spend.request");
  const bdSection = document.getElementById("bd-section"), spSection = document.getElementById("sp-section");
  if (!canBudget && bdSection) bdSection.style.display = "none";
  if (!canSpend && spSection) spSection.style.display = "none";
  if (canBudget && !canSpend && bdSection) bdSection.classList.replace("lg:col-span-5", "lg:col-span-12");
  if (canSpend && !canBudget && spSection) spSection.classList.replace("lg:col-span-7", "lg:col-span-12");

  let agreements = [];     // all agreements (with budget/committed/remaining)
  let requests = [];       // all spend requests (+ endorsement state)
  let pendingHash = null;  // SHA-256 of the file picked in the request form (or null)

  // ---------------------------------------------------------------- load
  async function loadAll() {
    agreements = await MACL.fetchAgreements();
    populateBudgetSelect();
    populateSpendSelect();
    renderBudgets();
    await renderRequests();
    renderPortfolio();
  }

  // Portfolio totals across ALL agreements (read-only; visible to every role). Budgeted /
  // committed (approved & locked against budget) / remaining / spent (settled with a receipt).
  function renderPortfolio() {
    const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0n);
    set("pf-budget", MACL.fmtMoney(sum(agreements, (r) => r.budget || 0n)));
    set("pf-committed", MACL.fmtMoney(sum(agreements, (r) => r.committed || 0n)));
    set("pf-remaining", MACL.fmtMoney(sum(agreements, (r) => r.remaining || 0n)));
    set("pf-spent", MACL.fmtMoney(sum(requests, (r) => (r.req.spent ? BigInt(r.req.amount) : 0n))));
  }

  // ---------------------------------------------------------------- selects
  // A recognisable label for an agreement, built from existing data (the contract has no
  // programme-name field): lead with the first target's indicator (what the programme measures),
  // note any extra targets, and the period in years — so the Donor/NGO can tell agreements apart.
  function agreementLabel(r) {
    const ts = r.targets || [];
    let what = "(no targets yet)";
    if (ts.length) {
      const ind = ts[0].indicator || "target";
      const short = ind.length > 24 ? ind.slice(0, 23) + "…" : ind;
      what = ts.length > 1 ? `${short} (+${ts.length - 1} more)` : short;
    }
    const yr = (d) => new Date(Number(d) * 1000).getFullYear();
    return `#${r.id} · ${what} · ${yr(r.a.startDate)}→${yr(r.a.endDate)}`;
  }

  function populateBudgetSelect() {
    const sel = document.getElementById("bd-agreement");
    const drafts = agreements.filter((r) => !r.finalised);
    sel.innerHTML = drafts.length
      ? `<option disabled selected value="">Choose a draft agreement…</option>` +
        drafts.map((r) => `<option value="${r.id}">${MACL.esc(agreementLabel(r))} · budget ${MACL.fmtMoney(r.budget)}</option>`).join("")
      : `<option disabled selected value="">No draft agreements (budgets lock at finalisation)</option>`;
  }

  function populateSpendSelect() {
    const sel = document.getElementById("sp-agreement");
    const fundable = agreements.filter((r) => r.finalised && r.budget > 0n);
    sel.innerHTML = fundable.length
      ? `<option disabled selected value="">Choose a finalised, budgeted agreement…</option>` +
        fundable.map((r) => `<option value="${r.id}">${MACL.esc(agreementLabel(r))} · ${MACL.fmtMoney(r.remaining)} remaining</option>`).join("")
      : `<option disabled selected value="">No finalised agreement has a budget yet</option>`;
    sel.onchange = onPickFundable;
    onPickFundable();
  }

  function pickedAgreement() {
    return agreements.find((r) => r.id === document.getElementById("sp-agreement").value);
  }
  async function onPickFundable() {
    const r = pickedAgreement();
    set("sp-remaining", r ? `Remaining budget: ${MACL.fmtMoney(r.remaining)}` : "");
    validateAmount();
    // BL-8: flag (do NOT block) raising spend on a programme that is failing targets.
    const warn = document.getElementById("sp-compliance-warn");
    if (warn) {
      warn.classList.add("hidden");
      if (r && await MACL.hasFailingRecords(r.id)) {
        warn.textContent = "⚠ This programme has a failing compliance record. Spend is still allowed (the 2-of-3 approval decides), but approvers should weigh this.";
        warn.classList.remove("hidden");
      }
    }
  }

  // Mirror the contract's over-budget check in the UI so the user gets an
  // immediate, friendly message instead of a revert.
  function validateAmount() {
    const r = pickedAgreement();
    const amount = document.getElementById("sp-amount").value.trim();
    const err = document.getElementById("sp-amount-err");
    const btn = document.getElementById("sp-submit");
    let over = false;
    if (r && amount !== "") { try { over = BigInt(amount) > r.remaining; } catch (_) {} }
    err.classList.toggle("hidden", !over);
    btn.disabled = over;
    return !over;
  }
  document.getElementById("sp-amount").addEventListener("input", validateAmount);

  // ---------------------------------------------------------------- supporting document upload
  // The file is stored in the document store (BL-12) and the server returns its
  // SHA-256, which we then put on-chain. Only the hash goes on-chain.
  document.getElementById("sp-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    const out = document.getElementById("sp-filehash");
    if (!file) { pendingHash = null; out.textContent = "No file selected."; return; }
    out.textContent = "Uploading & hashing on the server…";
    try {
      const doc = await MACL.uploadDocument(file);
      pendingHash = doc.hash;
      out.innerHTML = `Stored · SHA-256 on-chain: <span class="text-primary">${pendingHash}</span>`;
    } catch (err) {
      pendingHash = null;
      out.textContent = "Could not store file: " + MACL.parseError(err);
    }
  });

  // ---------------------------------------------------------------- budgets table
  function renderBudgets() {
    const body = document.getElementById("bd-rows");
    if (!agreements.length) {
      body.innerHTML = `<tr><td class="px-6 py-6 text-sm text-on-surface-variant" colspan="6">No agreements yet. Create one on the Agreements page.</td></tr>`;
      return;
    }
    body.innerHTML = agreements.map((r) => {
      const status = r.finalised
        ? `<span class="bg-green-100 text-green-800 font-label-caps text-[10px] px-2 py-1 rounded tracking-wider">FINALISED</span>`
        : `<span class="bg-amber-100 text-amber-800 font-label-caps text-[10px] px-2 py-1 rounded tracking-wider">DRAFT</span>`;
      const hasBudget = r.budget > 0n;
      const pct = hasBudget ? Number((r.committed * 100n) / r.budget) : 0;
      const bar = hasBudget
        ? `<div class="flex items-center gap-2"><div class="w-32 bg-surface-container-high h-2 rounded-full overflow-hidden"><div class="bg-primary h-full" style="width:${pct}%"></div></div><span class="text-xs text-on-surface-variant">${pct}%</span></div>`
        : `<span class="text-xs text-on-surface-variant">${r.finalised ? "no budget set" : "set a budget below"}</span>`;
      return `<tr class="border-b border-outline-variant hover:bg-surface-container-low transition-colors">
<td class="px-6 py-4 font-code-metadata text-code-metadata text-primary">#${r.id}</td>
<td class="px-6 py-4">${status}</td>
<td class="px-6 py-4 text-right font-code-metadata text-sm">${hasBudget ? MACL.fmtMoney(r.budget) : "—"}</td>
<td class="px-6 py-4 text-right font-code-metadata text-sm">${hasBudget ? MACL.fmtMoney(r.committed) : "—"}</td>
<td class="px-6 py-4 text-right font-code-metadata text-sm font-bold ${hasBudget ? "text-primary" : "text-on-surface-variant"}">${hasBudget ? MACL.fmtMoney(r.remaining) : "—"}</td>
<td class="px-6 py-4">${bar}</td>
</tr>`;
    }).join("");
  }

  // ---------------------------------------------------------------- spend requests table
  const roles = Object.entries(cfg.ROLES);
  const total = roles.length;            // 3 possible endorsers
  const threshold = cfg.ENDORSEMENT_THRESHOLD; // approve at 2

  // Derive a request's status from its on-chain state.
  // Lifecycle: PENDING -> APPROVED (2-of-3) -> SPENT (requester pins the receipt).
  function statusOf(r) {
    if (r.req.spent) return "SPENT";
    if (r.req.approved) return "APPROVED";
    // With 3 parties and a 2-of-3 rule, 2+ declines makes approval impossible.
    if (Number(r.declines) > total - threshold) return "REJECTED";
    return "PENDING";
  }
  const statusPill = (s) => {
    const cls = { APPROVED: "status-pill-approved", PENDING: "status-pill-pending", REJECTED: "status-pill-rejected", SPENT: "status-pill-spent" }[s];
    return `<span class="${cls} px-3 py-1 rounded-full text-[10px] font-bold">${s}</span>`;
  };

  // Integrity badge — single-node confirmation locally; cross-node agreement on Besu.
  function badgeFor(integ) {
    if (!integ || !integ.ok) {
      return `<span class="inline-flex items-center gap-1 text-xs text-error" title="${MACL.esc(integ ? integ.detail : "unverifiable")}"><span class="material-symbols-outlined text-sm">error</span>${MACL.esc(integ ? integ.label : "Unverifiable")}</span>`;
    }
    if (integ.nodes) {
      const { agree, total: t } = integ.nodes;
      const all = agree === t, maj = agree >= 2; // 2-of-3 majority
      const cls = all ? "text-primary" : maj ? "text-amber-600" : "text-error";
      const icon = all ? "verified" : maj ? "warning" : "error";
      const text = all ? `verified across ${t} nodes` : `${agree} of ${t} nodes agree`;
      const detail = all
        ? "All three nodes hold an identical copy of this request."
        : `Only ${agree} of ${t} nodes hold this request — the rest are out of sync or unreachable. The 2-of-3 majority record stands.`;
      return `<span class="inline-flex items-center gap-1 text-xs ${cls}" title="${MACL.esc(detail)}"><span class="material-symbols-outlined text-sm">${icon}</span>${text}</span>`;
    }
    return `<span class="inline-flex items-center gap-1 text-xs ${integ.locked ? "text-primary" : "text-on-surface-variant"}" title="${MACL.esc(integ.detail)}"><span class="material-symbols-outlined text-sm">${integ.locked ? "verified" : "schedule"}</span>${MACL.esc(integ.label)}</span>`;
  }

  async function renderRequests() {
    const acting = MACL.roleMeta();
    const actingAddr = acting.address.toLowerCase();
    requests = await MACL.fetchSpendRequests(acting.address);
    set("sp-count", `${requests.length} request${requests.length === 1 ? "" : "s"}`);

    const body = document.getElementById("sp-rows");
    if (!requests.length) {
      body.innerHTML = `<tr><td class="px-6 py-6 text-sm text-on-surface-variant" colspan="7">No spend requests yet. Once the NGO raises one, the other two organisations approve it (2-of-3).</td></tr>`;
      return;
    }
    const actingLabel = acting.label;

    // BL-8: which agreements are failing targets — for a per-row, non-blocking flag.
    const agIds = [...new Set(requests.map((r) => r.req.agreementId.toString()))];
    const failFlags = await Promise.all(agIds.map((id) => MACL.hasFailingRecords(id)));
    const failingByAgreement = Object.fromEntries(agIds.map((id, i) => [id, failFlags[i]]));

    // Build each row (integrity badge needs an await, so map → Promise.all).
    const html = await Promise.all(requests.map(async (r) => {
      const id = r.req.id.toString();
      const s = statusOf(r);
      const count = Number(r.count);
      const progFailing = failingByAgreement[r.req.agreementId.toString()];
      const integ = await MACL.verifyRecord({ kind: "spend", id });
      const badge = badgeFor(integ);

      // 2-of-3 progress meter
      const pct = Math.min(100, Math.round((count / threshold) * 100));
      const meter = `<div class="flex items-center gap-2"><div class="w-24 bg-surface-container-high h-1.5 rounded-full overflow-hidden"><div class="bg-primary h-full" style="width:${pct}%"></div></div><span class="text-xs font-medium text-on-surface-variant">${count}/${threshold}</span></div>${Number(r.declines) ? `<span class="text-[10px] text-error">${r.declines} declined</span>` : ""}`;

      // actions: endorse / decline (the two NON-submitter roles only).
      // Decision B — no self-approval: the org that raised the request sees no
      // approve/decline controls on its own request (the contract also reverts it).
      const isSubmitter = r.req.requester.toLowerCase() === actingAddr;
      let action = "";
      if (s === "PENDING") {
        if (isSubmitter) action = `<span class="text-[10px] text-on-surface-variant">Your request — needs the other two parties to approve</span>`;
        else if (r.endorsedByActing) action = `<span class="text-[10px] text-on-surface-variant">${MACL.esc(actingLabel)} endorsed</span>`;
        else if (r.declinedByActing) action = `<span class="text-[10px] text-error">${MACL.esc(actingLabel)} declined</span>`;
        else action = `<div class="flex gap-1 no-print">
<button data-endorse="${id}" data-perm="spend.endorse" data-help="endorse" onclick="event.stopPropagation()" class="bg-primary text-white px-2.5 py-1 rounded text-xs font-semibold hover:opacity-90 active:scale-95 transition-all">Endorse</button>
<button data-decline="${id}" data-perm="spend.decline" data-help="decline" onclick="event.stopPropagation()" class="border border-error text-error px-2.5 py-1 rounded text-xs font-semibold hover:bg-error hover:text-white active:scale-95 transition-all">Decline</button>
</div>`;
      }

      const summary = `<tr class="hover:bg-surface-container-low cursor-pointer transition-colors group" onclick="toggleRow('spend-${id}')">
<td class="px-6 py-5"><div class="flex flex-col"><span class="font-semibold text-on-surface">Request #${id}</span><span class="text-xs text-on-surface-variant font-code-metadata">Agreement #${r.req.agreementId}</span>${progFailing ? `<span class="text-[10px] text-amber-600 mt-0.5" title="This programme has a failing compliance record. Spend is not blocked; the 2-of-3 approval decides.">⚠ programme failing targets</span>` : ""}</div></td>
<td class="px-6 py-5 text-on-surface-variant">${MACL.esc(r.req.purpose)}</td>
<td class="px-6 py-5 text-right font-code-metadata text-sm">${MACL.fmtMoney(r.req.amount)}</td>
<td class="px-6 py-5">${badge}</td>
<td class="px-6 py-5">${meter}${action}</td>
<td class="px-6 py-5">${statusPill(s)}</td>
<td class="px-6 py-5 text-right"><span class="material-symbols-outlined text-outline group-hover:text-primary transition-transform duration-300" id="icon-spend-${id}">expand_more</span></td>
</tr>`;

      // expand: full fingerprint + verify-document control + endorsement note
      const docBlock = integ.hasDocument
        ? `<div class="bg-surface-container-lowest p-4 border border-outline-variant rounded">
<span class="text-[10px] text-on-surface-variant block mb-1">SUPPORTING-DOCUMENT FINGERPRINT (SHA-256)</span>
<div class="font-code-metadata text-[11px] break-all text-on-surface">${MACL.esc(r.req.documentHash)}</div>
<div class="mt-3 flex flex-wrap items-center gap-2">
<a href="#" onclick="MACL_UI.viewDoc('${r.req.documentHash}'); return false;" class="text-xs text-primary font-semibold hover:underline">View</a>
<button type="button" data-verify-stored="${r.req.documentHash}" data-out="verify-out-${id}" class="text-xs text-primary font-semibold hover:underline">Verify</button>
<span class="text-xs font-semibold" id="verify-out-${id}"></span>
</div>
<p class="text-[10px] text-on-surface-variant mt-2">Verify re-hashes the stored file on the server against the on-chain hash: a match proves it is unchanged since recorded — it does <b>not</b> prove the document was genuine in the first place.</p>
</div>`
        : `<div class="bg-surface-container-lowest p-4 border border-outline-variant rounded text-xs text-on-surface-variant">No supporting document attached to this request.</div>`;

      const remaining = Math.max(0, threshold - count);
      const note = r.req.approved
        ? "Approved 2-of-3 — locked and committed against the budget."
        : s === "REJECTED"
          ? "Declined by enough parties that 2-of-3 approval can no longer be reached."
          : `${remaining} more endorsement${remaining === 1 ? "" : "s"} needed to approve (2-of-3). A party may endorse or decline once.`;

      // BL-7: post-approval settlement — pin the actual receipt's SHA-256 (requester only),
      // then anyone can re-verify a file against it. Lifecycle: approved -> spent.
      let settlementBlock = "";
      if (r.req.spent) {
        settlementBlock = `<div class="mt-8">
<h4 class="text-label-caps text-on-surface-variant border-b border-outline-variant pb-2">SETTLEMENT — RECEIPT (SPENT ${MACL.esc(MACL.fmtTs(r.req.spentAt))})</h4>
<div class="bg-surface-container-lowest p-4 border border-outline-variant rounded mt-3">
<span class="text-[10px] text-on-surface-variant block mb-1">RECEIPT FINGERPRINT (SHA-256)</span>
<div class="font-code-metadata text-[11px] break-all text-on-surface">${MACL.esc(r.req.receiptHash)}</div>
<div class="mt-3 flex flex-wrap items-center gap-2">
<a href="#" onclick="MACL_UI.viewDoc('${r.req.receiptHash}'); return false;" class="text-xs text-primary font-semibold hover:underline">View</a>
<button type="button" data-verify-stored="${r.req.receiptHash}" data-out="verify-receipt-out-${id}" class="text-xs text-primary font-semibold hover:underline">Verify</button>
<span class="text-xs font-semibold" id="verify-receipt-out-${id}"></span>
</div>
<p class="text-[10px] text-on-surface-variant mt-2">Verify re-hashes the stored receipt on the server against the on-chain hash: a match proves it is unchanged since recorded.</p>
</div>
</div>`;
      } else if (s === "APPROVED" && isSubmitter) {
        settlementBlock = `<div class="mt-8 no-print">
<h4 class="text-label-caps text-on-surface-variant border-b border-outline-variant pb-2">SETTLEMENT — RECORD THE RECEIPT</h4>
<p class="text-xs text-on-surface-variant mt-2">Approved 2-of-3. After the funds move through normal banking, pin the ACTUAL receipt's fingerprint to close this out. The receipt is uploaded to the server and only its SHA-256 is recorded on-chain — never the file itself.</p>
<div class="mt-3 flex flex-wrap items-center gap-2">
<input type="file" data-receipt="${id}" class="text-xs file:mr-2 file:rounded file:border-0 file:bg-primary-container file:text-white file:px-2 file:py-1 file:text-[11px]"/>
<button data-mark-spent="${id}" class="bg-primary text-white px-3 py-1.5 rounded text-xs font-semibold hover:opacity-90 active:scale-95 transition-all">Mark as spent</button>
</div>
</div>`;
      } else if (s === "APPROVED") {
        settlementBlock = `<div class="mt-8"><p class="text-xs text-on-surface-variant">Approved — awaiting <span class="font-semibold">${MACL.esc(MACL.labelForAddress(r.req.requester))}</span> to record the receipt.</p></div>`;
      }

      const expand = `<tr class="hidden bg-surface-container-low/50" id="spend-${id}">
<td class="px-8 py-6 border-l-4 ${r.req.approved ? "border-primary" : s === "REJECTED" ? "border-error" : "border-outline-variant"}" colspan="7">
<div class="grid grid-cols-1 md:grid-cols-2 gap-10">
<div class="space-y-2">
<h4 class="text-label-caps text-on-surface-variant border-b border-outline-variant pb-2">APPROVAL STATE (${count}/${total} endorsed · approves at ${threshold})</h4>
<p class="text-sm text-on-surface">Requested by <span class="font-bold text-primary">${MACL.esc(MACL.labelForAddress(r.req.requester))}</span></p>
<p class="text-sm text-on-surface">Amount <span class="font-bold">${MACL.fmtMoney(r.req.amount)}</span></p>
<p class="text-xs text-on-surface-variant">${note}</p>
${(r.endorsers && r.endorsers.length) ? r.endorsers.map((m) => `<p class="text-xs text-on-surface"><span class="font-semibold text-primary">${MACL.esc(m.label)}</span> endorsed</p>`).join("") : ""}
${(r.decliners && r.decliners.length) ? r.decliners.map((m) => `<p class="text-xs text-error"><span class="font-semibold">${MACL.esc(m.label)}</span> declined</p>`).join("") : ""}
</div>
<div class="space-y-3">
<h4 class="text-label-caps text-on-surface-variant border-b border-outline-variant pb-2">EVIDENCE INTEGRITY</h4>
${docBlock}
</div>
</div>
${settlementBlock}
</td>
</tr>`;
      return summary + expand;
    }));

    body.innerHTML = html.join("");

    // wire endorse / decline
    body.querySelectorAll("button[data-endorse]").forEach((b) =>
      b.onclick = (e) => { e.stopPropagation(); act("endorseSpend", b.getAttribute("data-endorse")); });
    body.querySelectorAll("button[data-decline]").forEach((b) =>
      b.onclick = (e) => { e.stopPropagation(); act("declineSpend", b.getAttribute("data-decline")); });

    // wire "Mark as spent" (BL-7) — requester pins the actual receipt's hash.
    body.querySelectorAll("button[data-mark-spent]").forEach((b) =>
      b.onclick = (e) => { e.stopPropagation(); markSpent(b.getAttribute("data-mark-spent")); });

    // wire the one-click View/Verify controls for supporting docs + receipts (BL-14)
    MACL_UI.wireVerify(body);

    // Export the spend ledger (audit traceability, proposal RQ3) — available to every role.
    const exp = document.getElementById("sp-export");
    if (exp) exp.onclick = () => MACL_UI.exportCSV(
      "macl-spend.csv",
      ["requestId", "agreementId", "purpose", "amount", "status", "endorsements", "declines", "documentHash", "receiptHash", "spent", "spentAt"],
      requests.map((r) => [
        r.req.id, r.req.agreementId, r.req.purpose, r.req.amount, statusOf(r),
        `${r.count}/${threshold}`, r.declines, r.req.documentHash, r.req.receiptHash,
        r.req.spent, r.req.spent ? MACL.fmtTs(r.req.spentAt) : "",
      ])
    );
  }

  // Hash the chosen receipt file in the browser, then pin its SHA-256 on-chain.
  async function markSpent(id) {
    const inp = document.querySelector(`input[data-receipt="${id}"]`);
    const file = inp && inp.files[0];
    if (!file) return MACL.toast("No receipt", "Choose the receipt file first.", "err");
    // Store the receipt; the server returns its SHA-256, which goes on-chain.
    let receiptHash;
    try { receiptHash = (await MACL.uploadDocument(file)).hash; }
    catch (err) { return MACL.toast("Could not store receipt", MACL.parseError(err), "err"); }
    const { compliance } = MACL.contracts(MACL.getRole());
    try { await MACL.withTx(`Mark spend #${id} as spent`, () => compliance.markSpent(BigInt(id), receiptHash)); }
    catch (_) { return; }
    await loadAll();
  }

  async function act(method, id) {
    const { verification } = MACL.contracts(MACL.getRole());
    const label = method === "endorseSpend" ? `Endorse spend #${id}` : `Decline spend #${id}`;
    try { await MACL.withTx(label, () => verification[method](BigInt(id))); }
    catch (_) { return; }
    await loadAll();
  }

  // ---------------------------------------------------------------- set budget (Donor)
  document.getElementById("budgetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("bd-agreement").value;
    const amt = document.getElementById("bd-amount").value.trim();
    if (!id) return MACL.toast("No agreement", "Choose a draft agreement.", "err");
    if (amt === "") return MACL.toast("No amount", "Enter a budget amount.", "err");

    const { agreement } = MACL.contracts(MACL.getRole());
    try { await MACL.withTx(`Set budget on agreement #${id}`, () => agreement.setBudget(BigInt(id), BigInt(amt))); }
    catch (_) { return; }
    document.getElementById("bd-amount").value = "";
    await loadAll();
  });

  // ---------------------------------------------------------------- raise spend request (NGO)
  document.getElementById("spendForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("sp-agreement").value;
    const amt = document.getElementById("sp-amount").value.trim();
    const purpose = document.getElementById("sp-purpose").value.trim();
    if (!id) return MACL.toast("No agreement", "Choose a finalised, budgeted agreement.", "err");
    if (amt === "") return MACL.toast("No amount", "Enter an amount.", "err");
    if (!purpose) return MACL.toast("No purpose", "Describe what the spend is for.", "err");
    if (!validateAmount()) return MACL.toast("Over budget", "Amount exceeds the remaining budget.", "err");

    const docHash = pendingHash || null; // no file → API stores a zero hash (evidence optional)
    const { compliance } = MACL.contracts(MACL.getRole());
    try {
      await MACL.withTx("Raise spend request", () =>
        compliance.createSpendRequest(BigInt(id), BigInt(amt), purpose, docHash));
    } catch (_) { return; }

    // reset form
    document.getElementById("spendForm").reset();
    pendingHash = null;
    set("sp-filehash", "No file selected.");
    await loadAll();
  });

  await loadAll();
});
