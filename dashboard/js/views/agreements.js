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

  // --- modal setup: signatories checkboxes + unit datalist + default dates
  const sigHost = document.getElementById("ag-signatories");
  if (sigHost) {
    sigHost.innerHTML = Object.values(cfg.ROLES).map((r) =>
      `<label class="flex items-center gap-2 text-sm">
        <input type="checkbox" class="ag-sig" value="${r.address}" checked/>
        <span class="font-semibold">${MACL.esc(r.label)}</span>
        <span class="font-code-metadata text-xs text-on-surface-variant">${MACL.shortAddr(r.address)}</span>
       </label>`).join("");
  }
  const units = document.getElementById("ag-units");
  if (units) units.innerHTML = cfg.UNIT_OPTIONS.map((u) => `<option value="${u}">`).join("");
  const today = new Date(), plusYear = new Date();
  plusYear.setFullYear(today.getFullYear() + 1);
  const iso = (d) => d.toISOString().slice(0, 10);
  if (document.getElementById("ag-start")) document.getElementById("ag-start").value = iso(today);
  if (document.getElementById("ag-end")) document.getElementById("ag-end").value = iso(plusYear);

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
        else if (mine) action = `<button data-finalise="${r.id}" data-perm="agreement.finalise" class="bg-primary text-white px-3 py-1.5 rounded text-sm font-semibold hover:opacity-90 active:scale-95 transition-all">Finalise &amp; Lock</button>`;
        else action = `<span class="text-xs text-on-surface-variant" title="${MACL.esc(r.a.creator)}">only ${MACL.labelForAddress(r.a.creator)} can finalise</span>`;
        return `<tr class="border-b border-outline-variant hover:bg-surface-container-low transition-colors">
<td class="p-4 font-code-metadata text-code-metadata text-primary">#${r.id}<div class="text-[10px] text-outline">${MACL.labelForAddress(r.a.creator)}</div></td>
<td class="p-4 text-body-sm">${r.a.signatories.length} signator${r.a.signatories.length === 1 ? "y" : "ies"}</td>
<td class="p-4 text-body-sm">${MACL.fmtTs(r.a.startDate).slice(0, 10)}<br/>→ ${MACL.fmtTs(r.a.endDate).slice(0, 10)}</td>
<td class="p-4"><span class="bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded-full text-xs">${r.targets.length} target${r.targets.length === 1 ? "" : "s"}</span></td>
<td class="p-4">${status}</td>
<td class="p-4">${action}</td>
</tr>`;
      }).join("");
      body.querySelectorAll("button[data-finalise]").forEach((b) =>
        b.onclick = () => finalise(b.getAttribute("data-finalise")));
    }

    // Audit ledger timeline (recent agreement events)
    await renderLedger();
  }

  async function renderLedger() {
    const host = document.getElementById("ag-ledger");
    if (!host) return;
    // The API returns recent agreement lifecycle events (created / target / locked).
    const evs = await MACL.fetchAgreementEvents(6);
    host.innerHTML = evs.map((e) => {
      const title = e.name === "TargetAdded"
        ? `Target added to agreement #${e.id}`
        : e.name === "AgreementFinalised" ? `Agreement #${e.id} locked` : `Agreement #${e.id} created`;
      return `<div class="ledger-stroke">
<p class="text-xs font-code-metadata text-on-surface-variant">${MACL.fmtTs(e.timestamp)}</p>
<p class="text-sm font-semibold">${MACL.esc(title)}</p>
<p class="text-xs text-on-surface-variant">block #${e.blockNumber}</p>
</div>`;
    }).join("") || `<p class="text-xs text-on-surface-variant">No agreement activity yet.</p>`;
  }

  // --- actions
  async function finalise(id) {
    const { agreement } = MACL.contracts(MACL.getRole());
    try { await MACL.withTx(`Finalise agreement #${id}`, () => agreement.finaliseAgreement(BigInt(id))); }
    catch (_) { return; }
    await load();
  }

  document.getElementById("ag-create").onclick = async () => {
    const start = MACL.toUnix(document.getElementById("ag-start").value);
    const end = MACL.toUnix(document.getElementById("ag-end").value);
    if (!start || !end || end <= start) return MACL.toast("Invalid dates", "End must be after start.", "err");
    const sigs = [...document.querySelectorAll(".ag-sig:checked")].map((c) => c.value);
    if (!sigs.length) return MACL.toast("No signatories", "Select at least one signatory.", "err");

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
