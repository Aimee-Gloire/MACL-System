/*
 * Budget & Spend page — Part 1's contract logic, in the browser.
 *  - Donor-Admin sets a budget on a DRAFT agreement (locks at finalisation).
 *  - NGO raises a spend request (amount, purpose, supporting-document fingerprint).
 *    The document is hashed IN THE BROWSER (SHA-256) — only the hash is sent on-chain.
 *  - The two NON-submitter roles endorse/decline; a request is APPROVED at 2-of-3 and
 *    the remaining budget drops. The submitter cannot approve its own request.
 *  - Each request carries an integrity badge (MACL.verifyRecord) and a
 *    "Verify document" control (MACL.verifyDocument) to re-check the document.
 * Everything reads straight from the contracts via ethers — no API.
 */
MACL_UI.ready(async () => {
  const cfg = MACL.cfg;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("sp-acting", MACL.roleMeta().label + " Console");

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
  }

  // ---------------------------------------------------------------- selects
  function populateBudgetSelect() {
    const sel = document.getElementById("bd-agreement");
    const drafts = agreements.filter((r) => !r.finalised);
    sel.innerHTML = drafts.length
      ? `<option disabled selected value="">Choose a draft agreement…</option>` +
        drafts.map((r) => `<option value="${r.id}">Agreement #${r.id} — current budget ${MACL.fmtMoney(r.budget)}</option>`).join("")
      : `<option disabled selected value="">No draft agreements (budgets lock at finalisation)</option>`;
  }

  function populateSpendSelect() {
    const sel = document.getElementById("sp-agreement");
    const fundable = agreements.filter((r) => r.finalised && r.budget > 0n);
    sel.innerHTML = fundable.length
      ? `<option disabled selected value="">Choose a finalised, budgeted agreement…</option>` +
        fundable.map((r) => `<option value="${r.id}">Agreement #${r.id} — ${MACL.fmtMoney(r.remaining)} remaining</option>`).join("")
      : `<option disabled selected value="">No finalised agreement has a budget yet</option>`;
    sel.onchange = onPickFundable;
    onPickFundable();
  }

  function pickedAgreement() {
    return agreements.find((r) => r.id === document.getElementById("sp-agreement").value);
  }
  function onPickFundable() {
    const r = pickedAgreement();
    set("sp-remaining", r ? `Remaining budget: ${MACL.fmtMoney(r.remaining)}` : "");
    validateAmount();
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

  // ---------------------------------------------------------------- file hashing (in-browser)
  document.getElementById("sp-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    const out = document.getElementById("sp-filehash");
    if (!file) { pendingHash = null; out.textContent = "No file selected."; return; }
    out.textContent = "Hashing locally…";
    try {
      pendingHash = await MACL.hashFile(file);
      out.innerHTML = `SHA-256 (stays in browser): <span class="text-primary">${pendingHash}</span>`;
    } catch (err) {
      pendingHash = null;
      out.textContent = "Could not hash file: " + MACL.parseError(err);
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
  function statusOf(r) {
    if (r.req.approved) return "APPROVED";
    // With 3 parties and a 2-of-3 rule, 2+ declines makes approval impossible.
    if (Number(r.declines) > total - threshold) return "REJECTED";
    return "PENDING";
  }
  const statusPill = (s) => {
    const cls = { APPROVED: "status-pill-approved", PENDING: "status-pill-pending", REJECTED: "status-pill-rejected" }[s];
    return `<span class="${cls} px-3 py-1 rounded-full text-[10px] font-bold">${s}</span>`;
  };

  async function renderRequests() {
    const acting = MACL.roleMeta();
    const actingAddr = acting.address.toLowerCase();
    requests = await MACL.fetchSpendRequests(acting.address);
    set("sp-count", `${requests.length} request${requests.length === 1 ? "" : "s"}`);

    const body = document.getElementById("sp-rows");
    if (!requests.length) {
      body.innerHTML = `<tr><td class="px-6 py-6 text-sm text-on-surface-variant" colspan="7">No spend requests yet. The NGO can raise one above.</td></tr>`;
      return;
    }
    const actingLabel = acting.label;

    // Build each row (integrity badge needs an await, so map → Promise.all).
    const html = await Promise.all(requests.map(async (r) => {
      const id = r.req.id.toString();
      const s = statusOf(r);
      const count = Number(r.count);
      const integ = await MACL.verifyRecord({ kind: "spend", id });
      const badge = integ.ok
        ? `<span class="inline-flex items-center gap-1 text-xs ${integ.locked ? "text-primary" : "text-on-surface-variant"}" title="${MACL.esc(integ.detail)}"><span class="material-symbols-outlined text-sm">${integ.locked ? "verified" : "schedule"}</span>${MACL.esc(integ.label)}</span>`
        : `<span class="inline-flex items-center gap-1 text-xs text-error" title="${MACL.esc(integ.detail)}"><span class="material-symbols-outlined text-sm">error</span>${MACL.esc(integ.label)}</span>`;

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
<button data-endorse="${id}" data-perm="spend.endorse" onclick="event.stopPropagation()" class="bg-primary text-white px-2.5 py-1 rounded text-xs font-semibold hover:opacity-90 active:scale-95 transition-all">Endorse</button>
<button data-decline="${id}" data-perm="spend.decline" onclick="event.stopPropagation()" class="border border-error text-error px-2.5 py-1 rounded text-xs font-semibold hover:bg-error hover:text-white active:scale-95 transition-all">Decline</button>
</div>`;
      }

      const summary = `<tr class="hover:bg-surface-container-low cursor-pointer transition-colors group" onclick="toggleRow('spend-${id}')">
<td class="px-6 py-5"><div class="flex flex-col"><span class="font-semibold text-on-surface">Request #${id}</span><span class="text-xs text-on-surface-variant font-code-metadata">Agreement #${r.req.agreementId}</span></div></td>
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
<label class="text-xs text-on-surface-variant">Verify a file against this:</label>
<input type="file" data-verify="${id}" class="text-xs file:mr-2 file:rounded file:border-0 file:bg-primary-container file:text-white file:px-2 file:py-1 file:text-[11px]"/>
<span class="text-xs font-semibold" id="verify-out-${id}"></span>
</div>
<p class="text-[10px] text-on-surface-variant mt-2">A match proves the document has not been altered or swapped since approval. It does <b>not</b> prove the document was genuine in the first place.</p>
</div>`
        : `<div class="bg-surface-container-lowest p-4 border border-outline-variant rounded text-xs text-on-surface-variant">No supporting document attached to this request.</div>`;

      const remaining = Math.max(0, threshold - count);
      const note = r.req.approved
        ? "Approved 2-of-3 — locked and committed against the budget."
        : s === "REJECTED"
          ? "Declined by enough parties that 2-of-3 approval can no longer be reached."
          : `${remaining} more endorsement${remaining === 1 ? "" : "s"} needed to approve (2-of-3). A party may endorse or decline once.`;

      const expand = `<tr class="hidden bg-surface-container-low/50" id="spend-${id}">
<td class="px-8 py-6 border-l-4 ${r.req.approved ? "border-primary" : s === "REJECTED" ? "border-error" : "border-outline-variant"}" colspan="7">
<div class="grid grid-cols-1 md:grid-cols-2 gap-10">
<div class="space-y-2">
<h4 class="text-label-caps text-on-surface-variant border-b border-outline-variant pb-2">APPROVAL STATE (${count}/${total} endorsed · approves at ${threshold})</h4>
<p class="text-sm text-on-surface">Requested by <span class="font-bold text-primary">${MACL.esc(MACL.labelForAddress(r.req.requester))}</span></p>
<p class="text-sm text-on-surface">Amount <span class="font-bold">${MACL.fmtMoney(r.req.amount)}</span></p>
<p class="text-xs text-on-surface-variant">${note}</p>
</div>
<div class="space-y-3">
<h4 class="text-label-caps text-on-surface-variant border-b border-outline-variant pb-2">EVIDENCE INTEGRITY</h4>
${docBlock}
</div>
</div>
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

    // wire the "Verify document" file inputs
    body.querySelectorAll("input[data-verify]").forEach((inp) =>
      inp.onchange = async (e) => {
        e.stopPropagation();
        const id = inp.getAttribute("data-verify");
        const out = document.getElementById("verify-out-" + id);
        const req = requests.find((r) => r.req.id.toString() === id);
        const file = inp.files[0];
        if (!file || !req) return;
        out.textContent = "Checking…"; out.className = "text-xs font-semibold text-on-surface-variant";
        try {
          const v = await MACL.verifyDocument(file, req.req.documentHash);
          if (v.match) { out.textContent = "✓ Document verified — matches the ledger"; out.className = "text-xs font-semibold text-green-700"; }
          else { out.textContent = "✗ Does not match the ledger"; out.className = "text-xs font-semibold text-error"; }
        } catch (err) {
          out.textContent = MACL.parseError(err); out.className = "text-xs font-semibold text-error";
        }
      });
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

    const docHash = pendingHash || ethers.ZeroHash; // no file → zero hash (evidence optional)
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
