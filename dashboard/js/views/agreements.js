/*
 * Agreements page — list agreements, create new ones (+ targets), finalise.
 * Write calls (createAgreement/addTarget/finaliseAgreement) require the
 * acting account to be the agreement's creator, so they sign as MACL.getRole().
 */
MACL_UI.ready(async () => {
  const cfg = MACL.cfg;
  const acting = MACL.getRole();
  const actingAddr = MACL.roleMeta(acting).address.toLowerCase();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("ag-acting", MACL.roleMeta(acting).label);

  // --- modal setup: parties (read-only) + unit datalist + default dates
  // All three organisations are parties to every agreement. The 2-of-3 verification is a
  // FIXED threshold across the three, so fewer signatories would break finalisation (and
  // stall spend). We therefore show the three parties read-only instead of as optional
  // checkboxes, which previously let a Donor create an agreement that could never finalise.
  const sigHost = document.getElementById("ag-signatories");
  if (sigHost) {
    sigHost.innerHTML = Object.values(cfg.ROLES).map((r) =>
      `<div class="flex items-center gap-2 text-sm">
        <span class="material-symbols-outlined text-primary text-base">check_circle</span>
        <span class="font-semibold">${MACL.esc(r.label)}</span>
        <span class="font-code-metadata text-xs text-on-surface-variant">${MACL.shortAddr(r.address)}</span>
       </div>`).join("");
  }
  const units = document.getElementById("ag-units");
  if (units) units.innerHTML = cfg.UNIT_OPTIONS.map((u) => `<option value="${u}">`).join("");
  const today = new Date(), plusYear = new Date();
  plusYear.setFullYear(today.getFullYear() + 1);
  const iso = (d) => d.toISOString().slice(0, 10);
  if (document.getElementById("ag-start")) document.getElementById("ag-start").value = iso(today);
  if (document.getElementById("ag-end")) document.getElementById("ag-end").value = iso(plusYear);

  // Role scoping: only an org that can create agreements operates the write controls.
  // NGO/Audit still SEE the table, stats and activity (read), just not these buttons.
  if (!MACL.can("agreement.create")) {
    document
      .querySelectorAll('[data-perm="agreement.create"], [data-perm="agreement.addTarget"]')
      .forEach((el) => { el.style.display = "none"; });
  }

  // --- load + render
  async function load() {
    const rows = await MACL.fetchAgreements();
    set("ag-stat-total", rows.length);
    set("ag-stat-draft", rows.filter((r) => !r.finalised).length);
    set("ag-stat-final", rows.filter((r) => r.finalised).length);

    const body = document.getElementById("ag-rows");
    if (!rows.length) {
      body.innerHTML = `<tr><td class="p-4 text-sm text-on-surface-variant" colspan="6">No agreements yet. Use “Create New Agreement”.</td></tr>`;
    } else {
      body.innerHTML = rows.map((r) => {
        const mine = r.a.creator.toLowerCase() === actingAddr;
        const status = r.finalised
          ? `<span class="bg-green-100 text-green-800 font-label-caps text-[10px] px-2 py-1 rounded tracking-wider">FINALISED</span>`
          : `<span class="bg-amber-100 text-amber-800 font-label-caps text-[10px] px-2 py-1 rounded tracking-wider">DRAFT</span>`;
        let action;
        if (r.finalised) action = `<span class="material-symbols-outlined text-primary" title="locked">lock</span>`;
        else if (!r.targets.length) action = `<span class="text-xs text-on-surface-variant">add a target first</span>`;
        else if (mine) action = `<button data-finalise="${r.id}" data-perm="agreement.finalise" onclick="event.stopPropagation()" class="bg-primary text-white px-3 py-1.5 rounded text-sm font-semibold hover:opacity-90 active:scale-95 transition-all">Finalise &amp; Lock</button>`;
        else action = `<span class="text-xs text-on-surface-variant" title="${MACL.esc(r.a.creator)}">only ${MACL.labelForAddress(r.a.creator)} can finalise</span>`;

        // --- expandable detail: full agreement info + targets (proposal §3.3) ---
        const sigList = (r.a.signatories || []).length
          ? r.a.signatories.map((s) =>
              `<span class="inline-block bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded-full text-[11px] mr-1 mb-1">${MACL.esc(MACL.labelForAddress(s))}</span>`).join("")
          : `<span class="text-xs text-error">none — records can never finalise</span>`;

        const editable = mine && !r.finalised;
        const isoOf = (unix) => { try { return new Date(Number(unix) * 1000).toISOString().slice(0, 10); } catch (_) { return ""; } };

        const targetRows = r.targets.length
          ? r.targets.map((t, i) => {
              const controls = editable
                ? `<span class="flex items-center gap-2 shrink-0">
<button type="button" data-edit-target="${r.id}:${i}" class="text-[11px] text-primary font-semibold hover:underline">Edit</button>
<button type="button" data-remove-target="${r.id}:${i}" class="text-[11px] text-error font-semibold hover:underline">Remove</button>
</span>`
                : "";
              const editForm = editable
                ? `<div class="grid-cols-2 gap-2 mt-2" style="display:none" id="ag-edit-${r.id}-${i}">
<input data-f="indicator" value="${MACL.esc(t.indicator)}" class="col-span-2 border border-outline-variant rounded p-2 text-sm bg-white"/>
<input data-f="threshold" type="number" min="0" step="1" value="${t.threshold}" class="border border-outline-variant rounded p-2 text-sm bg-white"/>
<input data-f="unit" list="ag-units" value="${MACL.esc(t.unit)}" class="border border-outline-variant rounded p-2 text-sm bg-white"/>
<label class="col-span-2 text-[11px] text-on-surface-variant">Deadline<input data-f="deadline" type="date" value="${isoOf(t.deadline)}" class="mt-1 w-full border border-outline-variant rounded p-2 text-sm bg-white"/></label>
<button type="button" data-save-target="${r.id}:${i}" class="bg-primary text-white rounded py-1.5 text-sm font-semibold">Save</button>
<button type="button" data-cancel-target="${r.id}:${i}" class="border border-outline-variant rounded py-1.5 text-sm font-semibold">Cancel</button>
</div>`
                : "";
              return `<div class="py-1.5 border-b border-outline-variant last:border-0">
<div class="flex items-start justify-between gap-3">
<div class="min-w-0">
<div class="text-sm text-on-surface"><span class="font-code-metadata text-[10px] text-on-surface-variant mr-2">[${i}]</span>${MACL.esc(t.indicator)}</div>
<div class="text-xs text-on-surface-variant">≥ ${t.threshold} ${MACL.esc(t.unit)} · by ${MACL.fmtTs(t.deadline).slice(0, 10)}</div>
</div>
${controls}
</div>
${editForm}
</div>`;
            }).join("")
          : `<p class="text-xs text-on-surface-variant">No targets added yet.</p>`;

        // The creator can edit a DRAFT (add/edit/remove targets, change dates) until finalisation.
        const addTargetForm = editable
          ? `<div data-perm="agreement.addTarget" class="mt-4 pt-3 border-t border-outline-variant">
<p class="font-label-caps text-label-caps text-on-surface-variant mb-2">ADD A TARGET (draft only)</p>
<div class="grid grid-cols-2 gap-2" id="ag-addtarget-${r.id}">
<input data-f="indicator" class="col-span-2 border border-outline-variant rounded p-2 text-sm bg-white" placeholder="Indicator e.g. beneficiaries_reached"/>
<input data-f="threshold" type="number" min="0" step="1" class="border border-outline-variant rounded p-2 text-sm bg-white" placeholder="Threshold"/>
<input data-f="unit" list="ag-units" class="border border-outline-variant rounded p-2 text-sm bg-white" placeholder="Unit e.g. people"/>
<label class="col-span-2 text-[11px] text-on-surface-variant">Deadline<input data-f="deadline" type="date" class="mt-1 w-full border border-outline-variant rounded p-2 text-sm bg-white"/></label>
<button type="button" data-add-target="${r.id}" onclick="event.stopPropagation()" class="col-span-2 bg-primary text-white rounded py-2 text-sm font-semibold hover:opacity-90 active:scale-95 transition-all">Add target</button>
</div>
<p class="text-[11px] text-on-surface-variant mt-2">Signatories are fixed at creation. Targets and dates can be edited until you finalise — finalising locks everything.</p>
</div>`
          : "";

        return `<tr class="border-b border-outline-variant hover:bg-surface-container-low transition-colors cursor-pointer" data-expand="${r.id}">
<td class="p-4 font-code-metadata text-code-metadata text-primary"><div class="flex items-center gap-2"><span class="material-symbols-outlined text-outline text-base transition-transform" id="ag-chev-${r.id}">expand_more</span><div>#${r.id}<div class="text-[10px] text-outline">${MACL.labelForAddress(r.a.creator)}</div></div></div></td>
<td class="p-4 text-body-sm">${r.a.signatories.length}</td>
<td class="p-4 text-body-sm">${MACL.fmtTs(r.a.startDate).slice(0, 10)}<br/>→ ${MACL.fmtTs(r.a.endDate).slice(0, 10)}</td>
<td class="p-4"><span class="bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded-full text-xs">${r.targets.length} target${r.targets.length === 1 ? "" : "s"}</span></td>
<td class="p-4">${status}</td>
<td class="p-4">${action}</td>
</tr>
<tr class="hidden" id="ag-detail-${r.id}">
<td colspan="6" class="px-6 py-5 bg-surface-container-low/40">
<div class="grid grid-cols-1 md:grid-cols-2 gap-8">
<div>
<p class="font-label-caps text-label-caps text-on-surface-variant mb-2">AGREEMENT DETAILS</p>
<div class="space-y-1.5 text-sm">
<div class="flex justify-between gap-4"><span class="text-on-surface-variant">Creator</span><span class="font-medium">${MACL.esc(MACL.labelForAddress(r.a.creator))}</span></div>
<div class="flex justify-between gap-4 items-center"><span class="text-on-surface-variant">Period</span><span class="flex items-center gap-2"><span class="font-medium">${MACL.fmtTs(r.a.startDate).slice(0, 10)} → ${MACL.fmtTs(r.a.endDate).slice(0, 10)}</span>${editable ? `<button type="button" data-edit-dates="${r.id}" class="text-[11px] text-primary font-semibold hover:underline">Edit</button>` : ""}</span></div>
${editable ? `<div class="grid-cols-2 gap-2" style="display:none" id="ag-dates-${r.id}">
<input data-f="start" type="date" value="${isoOf(r.a.startDate)}" class="border border-outline-variant rounded p-2 text-sm bg-white"/>
<input data-f="end" type="date" value="${isoOf(r.a.endDate)}" class="border border-outline-variant rounded p-2 text-sm bg-white"/>
<button type="button" data-save-dates="${r.id}" class="bg-primary text-white rounded py-1.5 text-sm font-semibold">Save dates</button>
<button type="button" data-cancel-dates="${r.id}" class="border border-outline-variant rounded py-1.5 text-sm font-semibold">Cancel</button>
</div>` : ""}
<div class="flex justify-between gap-4"><span class="text-on-surface-variant">Status</span><span class="font-medium">${r.finalised ? "Finalised &amp; locked" : "Draft"}</span></div>
<div class="flex justify-between gap-4"><span class="text-on-surface-variant">Budget</span><span class="font-medium">${MACL.fmtMoney(r.budget)}</span></div>
</div>
<p class="font-label-caps text-label-caps text-on-surface-variant mt-4 mb-2">SIGNATORIES (can endorse / dispute)</p>
<div>${sigList}</div>
</div>
<div>
<p class="font-label-caps text-label-caps text-on-surface-variant mb-2">TARGETS (${r.targets.length})</p>
${targetRows}
${addTargetForm}
</div>
</div>
</td>
</tr>`;
      }).join("");

      body.querySelectorAll("button[data-finalise]").forEach((b) =>
        b.onclick = (e) => { e.stopPropagation(); finalise(b.getAttribute("data-finalise")); });

      body.querySelectorAll("button[data-add-target]").forEach((b) =>
        b.onclick = (e) => { e.stopPropagation(); addTargetToDraft(b.getAttribute("data-add-target")); });

      // Draft editing: toggle/save inline target edits, remove targets, edit dates.
      body.querySelectorAll("button[data-edit-target], button[data-cancel-target]").forEach((b) =>
        b.onclick = () => { const [id, i] = (b.getAttribute("data-edit-target") || b.getAttribute("data-cancel-target")).split(":"); toggleEl(`ag-edit-${id}-${i}`); });
      body.querySelectorAll("button[data-save-target]").forEach((b) =>
        b.onclick = () => saveTarget(b.getAttribute("data-save-target")));
      body.querySelectorAll("button[data-remove-target]").forEach((b) =>
        b.onclick = () => removeTargetUI(b.getAttribute("data-remove-target")));
      body.querySelectorAll("button[data-edit-dates], button[data-cancel-dates]").forEach((b) =>
        b.onclick = () => toggleEl(`ag-dates-${b.getAttribute("data-edit-dates") || b.getAttribute("data-cancel-dates")}`));
      body.querySelectorAll("button[data-save-dates]").forEach((b) =>
        b.onclick = () => saveDates(b.getAttribute("data-save-dates")));

      // Click a row to expand/collapse its detail.
      body.querySelectorAll("tr[data-expand]").forEach((row) =>
        row.onclick = () => {
          const id = row.getAttribute("data-expand");
          const detail = document.getElementById("ag-detail-" + id);
          const chev = document.getElementById("ag-chev-" + id);
          if (!detail) return;
          detail.classList.toggle("hidden");
          if (chev) chev.style.transform = detail.classList.contains("hidden") ? "" : "rotate(180deg)";
        });
    }

    // Audit ledger timeline (recent agreement events)
    await renderLedger();
  }

  async function renderLedger() {
    const host = document.getElementById("ag-ledger");
    if (!host) return;
    // The full agreement lifecycle (created / target add·edit·remove / dates / budget / locked).
    const evs = await MACL.fetchAgreementEvents(25);
    const TITLES = {
      AgreementCreated: (id) => `Agreement #${id} created`,
      TargetAdded: (id) => `Target added to agreement #${id}`,
      TargetEdited: (id) => `Target edited on agreement #${id}`,
      TargetRemoved: (id) => `Target removed from agreement #${id}`,
      AgreementDatesUpdated: (id) => `Dates updated on agreement #${id}`,
      BudgetSet: (id) => `Budget set on agreement #${id}`,
      AgreementFinalised: (id) => `Agreement #${id} locked`,
    };
    host.innerHTML = evs.map((e) => {
      const title = (TITLES[e.name] || ((id) => `Agreement #${id} updated`))(e.id);
      return `<div class="ledger-stroke">
<p class="text-xs font-code-metadata text-on-surface-variant">${MACL.fmtTs(e.timestamp)}</p>
<p class="text-sm font-semibold">${MACL.esc(title)}</p>
<p class="text-xs text-on-surface-variant">block #${e.blockNumber}</p>
</div>`;
    }).join("") || `<p class="text-xs text-on-surface-variant">No agreement activity yet.</p>`;
  }

  // --- actions
  // Toggle an inline panel's visibility (used by the per-target edit + date-edit forms).
  function toggleEl(elId) {
    const el = document.getElementById(elId);
    if (el) el.style.display = (el.style.display === "none" || !el.style.display) ? "grid" : "none";
  }

  async function finalise(id) {
    const { agreement } = MACL.contracts(MACL.getRole());
    try { await MACL.withTx(`Finalise agreement #${id}`, () => agreement.finaliseAgreement(BigInt(id))); }
    catch (_) { return; }
    await load();
  }

  // Edit an existing target on a DRAFT (creator only — enforced on-chain).
  async function saveTarget(key) {
    const [id, i] = key.split(":");
    const root = document.getElementById(`ag-edit-${id}-${i}`);
    if (!root) return;
    const v = (f) => root.querySelector(`[data-f="${f}"]`).value.trim();
    const indicator = v("indicator"), threshold = v("threshold"), unit = v("unit");
    const deadline = MACL.toUnix(v("deadline"));
    if (!indicator || !threshold || !unit || !deadline)
      return MACL.toast("Incomplete target", "Fill in indicator, threshold, unit and deadline.", "err");
    const { agreement } = MACL.contracts(MACL.getRole());
    try {
      await MACL.withTx(`Edit target [${i}]`, () =>
        agreement.editTarget(BigInt(id), BigInt(i), indicator, BigInt(threshold), unit, deadline));
    } catch (_) { return; }
    await load();
  }

  // Remove a target from a DRAFT (creator only).
  async function removeTargetUI(key) {
    const [id, i] = key.split(":");
    const { agreement } = MACL.contracts(MACL.getRole());
    try { await MACL.withTx(`Remove target [${i}]`, () => agreement.removeTarget(BigInt(id), BigInt(i))); }
    catch (_) { return; }
    await load();
  }

  // Update the start/end dates of a DRAFT (creator only).
  async function saveDates(id) {
    const root = document.getElementById(`ag-dates-${id}`);
    if (!root) return;
    const start = MACL.toUnix(root.querySelector('[data-f="start"]').value);
    const end = MACL.toUnix(root.querySelector('[data-f="end"]').value);
    if (!start || !end || end <= start) return MACL.toast("Invalid dates", "End must be after start.", "err");
    const { agreement } = MACL.contracts(MACL.getRole());
    try { await MACL.withTx(`Update dates #${id}`, () => agreement.updateDates(BigInt(id), start, end)); }
    catch (_) { return; }
    await load();
  }

  // Add a target to an existing DRAFT agreement (creator only — enforced on-chain too).
  async function addTargetToDraft(id) {
    const root = document.getElementById("ag-addtarget-" + id);
    if (!root) return;
    const val = (f) => root.querySelector(`[data-f="${f}"]`).value.trim();
    const indicator = val("indicator");
    const threshold = val("threshold");
    const unit = val("unit");
    const deadline = MACL.toUnix(val("deadline"));
    if (!indicator || !threshold || !unit || !deadline)
      return MACL.toast("Incomplete target", "Fill in indicator, threshold, unit and deadline.", "err");
    const { agreement } = MACL.contracts(MACL.getRole());
    try {
      await MACL.withTx(`Add target ${indicator}`, () =>
        agreement.addTarget(BigInt(id), indicator, BigInt(threshold), unit, deadline));
    } catch (_) { return; }
    await load();
  }

  document.getElementById("ag-create").onclick = async () => {
    const start = MACL.toUnix(document.getElementById("ag-start").value);
    const end = MACL.toUnix(document.getElementById("ag-end").value);
    if (!start || !end || end <= start) return MACL.toast("Invalid dates", "End must be after start.", "err");
    // Always all three parties — the fixed 2-of-3 verification requires them.
    const sigs = Object.values(cfg.ROLES).map((r) => r.address);

    const targets = [...document.querySelectorAll("#targets-container .target-row")].map((row) => ({
      indicator: row.querySelector('[data-field="indicator"]').value.trim(),
      threshold: row.querySelector('[data-field="threshold"]').value.trim(),
      unit: row.querySelector('[data-field="unit"]').value.trim(),
      deadline: MACL.toUnix(row.querySelector('[data-field="deadline"]').value),
    })).filter((t) => t.indicator && t.threshold && t.unit);
    if (!targets.length) return MACL.toast("No targets", "Add at least one complete target.", "err");

    const { agreement } = MACL.contracts(MACL.getRole());
    let receipt;
    try { receipt = await MACL.withTx("Create agreement", () => agreement.createAgreement(start, end, sigs)); }
    catch (_) { return; }
    // the API returns the new id (parsed from the AgreementCreated event server-side)
    const newId = receipt.id;
    for (const t of targets) {
      try { await MACL.withTx(`Add target ${t.indicator}`, () =>
        agreement.addTarget(newId, t.indicator, BigInt(t.threshold), t.unit, t.deadline)); }
      catch (_) { break; }
    }
    document.getElementById("agreement-modal").classList.add("hidden");
    MACL.toast("Agreement created", `#${newId} with ${targets.length} target(s) — still a draft until finalised`, "ok");
    await load();
  };

  await load();
});
