/*
 * Audit Trail page — every compliance record, its endorsement / decline
 * state, and the Endorse + Decline actions (sign as the acting role).
 * Finalisation happens at 2-of-3 endorsements; a 3rd endorsement is still
 * recorded for the audit trail. A party may endorse OR decline (not both).
 */
MACL_UI.ready(async () => {
  const cfg = MACL.cfg;
  const threshold = cfg.ENDORSEMENT_THRESHOLD;          // finalise at 2
  const roles = Object.entries(cfg.ROLES);             // [key, meta]
  const total = roles.length;                          // 3 possible endorsers
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  let rows = [];

  async function load() {
    const acting = MACL.roleMeta();
    rows = await MACL.fetchRecords(acting.address);

    // which of the 3 stakeholders endorsed / declined each record
    const { verification } = MACL.contracts();
    for (const r of rows) {
      r.endorsers = []; r.decliners = [];
      for (const [, meta] of roles) {
        if (await verification.hasEndorsed(BigInt(r.rec.id), meta.address)) r.endorsers.push(meta);
        else if (await verification.hasDeclined(BigInt(r.rec.id), meta.address)) r.decliners.push(meta);
      }
      // Integrity badge: the SAME verifyRecord() the spend page uses. It returns a
      // `nodes` field left null today; Part 4 fills it with the cross-node check.
      r.integrity = await MACL.verifyRecord({ kind: "record", id: r.rec.id });
    }

    const pass = rows.filter((r) => MACL.fmtResult(r.rec.result) === "PASS").length;
    const pending = rows.filter((r) => !r.rec.finalised).length;
    set("au-total", rows.length.toLocaleString());
    set("au-pending", pending.toLocaleString());
    set("au-rate", rows.length ? `${Math.round((pass / rows.length) * 100)}%` : "—");
    set("au-rate-note", rows.length ? `${pass}/${rows.length} reports PASS` : "no reports yet");
    set("au-count", `${rows.length} record${rows.length === 1 ? "" : "s"}`);
    try {
      const cid = (await MACL.getChainId()).toString();
      set("au-foot-chain", `CHAIN ${cid}`);
    } catch (_) {}

    renderTable();
  }

  const avatar = (meta, kind) =>
    `<div class="w-6 h-6 rounded-full border border-surface ${kind === "decline" ? "bg-red-700" : "bg-primary-container"} text-white text-[9px] font-bold flex items-center justify-center" title="${MACL.esc(meta.label)} ${kind === "decline" ? "declined" : "endorsed"}">${MACL.esc(meta.short.slice(0, 3).toUpperCase())}</div>`;
  const pill = (label) => {
    const c = { PASS: "bg-green-100 text-green-800", FAIL: "bg-red-100 text-red-800",
                FLAG: "bg-amber-100 text-amber-800", PENDING: "bg-surface-container-high text-on-surface-variant" }[label];
    return `<span class="px-2 py-1 ${c} text-[10px] font-bold rounded">${label}</span>`;
  };
  // Integrity badge — driven by MACL.verifyRecord (extensible to a cross-node
  // check in Part 4). Shown on finalised records.
  const integrityBadge = (integ) => {
    if (!integ || !integ.ok) {
      return `<span class="inline-flex items-center gap-1 text-[10px] text-error mt-1" title="${MACL.esc(integ ? integ.detail : "unverifiable")}"><span class="material-symbols-outlined text-xs">error</span>${MACL.esc(integ ? integ.label : "Unverifiable")}</span>`;
    }
    return `<span class="inline-flex items-center gap-1 text-[10px] text-primary mt-1" title="${MACL.esc(integ.detail)}"><span class="material-symbols-outlined text-xs">verified</span>${MACL.esc(integ.label)}</span>`;
  };

  function renderTable() {
    const body = document.getElementById("au-rows");
    if (!rows.length) {
      body.innerHTML = `<tr><td class="px-6 py-6 text-sm text-on-surface-variant" colspan="7">No records yet. The NGO must submit a report first.</td></tr>`;
      return;
    }
    const acting = MACL.getRole();
    const actingLabel = MACL.roleMeta(acting).label;

    body.innerHTML = rows.map((r) => {
      const id = r.rec.id.toString();
      const label = MACL.fmtResult(r.rec.result);
      const count = Number(r.count);
      const declines = Number(r.declines);
      const avatars = (r.endorsers.map((m) => avatar(m, "endorse")).join("") +
        r.decliners.map((m) => avatar(m, "decline")).join("")) ||
        `<div class="w-6 h-6 rounded-full border border-surface border-dashed bg-surface-container-low flex items-center justify-center text-[10px]">0</div>`;

      // status + actions
      let status, action = "";
      if (r.rec.finalised) {
        status = `<div class="flex flex-col"><span class="flex items-center gap-1.5 text-xs text-primary font-bold"><span class="material-symbols-outlined text-sm">lock</span>Finalised</span>${integrityBadge(r.integrity)}</div>`;
      } else if (declines > 0) {
        status = `<span class="flex items-center gap-1.5 text-xs text-error font-bold"><span class="material-symbols-outlined text-sm">warning</span>Disputed (${declines})</span>`;
      } else {
        status = `<span class="flex items-center gap-1.5 text-xs text-secondary"><span class="w-2 h-2 rounded-full bg-secondary"></span>In Progress</span>`;
      }
      if (!r.rec.finalised) {
        if (r.endorsedByActing) action = `<span class="text-[10px] text-on-surface-variant block mt-1">${MACL.esc(actingLabel)} endorsed</span>`;
        else if (r.declinedByActing) action = `<span class="text-[10px] text-error block mt-1">${MACL.esc(actingLabel)} declined</span>`;
        else action = `<div class="flex gap-1 mt-1 no-print">
<button data-endorse="${id}" data-perm="record.endorse" onclick="event.stopPropagation()" class="bg-primary text-white px-2.5 py-1 rounded text-xs font-semibold hover:opacity-90 active:scale-95 transition-all">Endorse</button>
<button data-decline="${id}" data-perm="record.decline" onclick="event.stopPropagation()" class="border border-error text-error px-2.5 py-1 rounded text-xs font-semibold hover:bg-error hover:text-white active:scale-95 transition-all">Decline</button>
</div>`;
      }

      const summary = `<tr class="hover:bg-surface-container-low cursor-pointer transition-colors group" onclick="toggleRow('row-${id}')">
<td class="px-6 py-5"><div class="flex flex-col"><span class="font-semibold text-on-surface">Record #${id}</span><span class="text-xs text-on-surface-variant font-code-metadata">Agreement #${r.rec.agreementId}</span></div></td>
<td class="px-6 py-5 text-on-surface-variant">${MACL.esc(r.target.indicator)} ≥ ${r.target.threshold} ${MACL.esc(r.target.unit)}</td>
<td class="px-6 py-5 font-code-metadata text-on-surface">${r.rec.reportedValue} ${MACL.esc(r.target.unit)}</td>
<td class="px-6 py-5">${pill(label)}</td>
<td class="px-6 py-5"><div class="flex items-center gap-2"><div class="flex -space-x-2">${avatars}</div><span class="text-xs font-medium text-on-surface-variant">${count}/${total} endorsed</span></div>${declines ? `<span class="text-[10px] text-error">${declines} declined</span>` : ""}</td>
<td class="px-6 py-5">${status}${action}</td>
<td class="px-6 py-5 text-right"><span class="material-symbols-outlined text-outline group-hover:text-primary transition-transform duration-300" id="icon-row-${id}">expand_more</span></td>
</tr>`;

      const endorserList = r.endorsers.length
        ? r.endorsers.map((m) => `<p class="text-sm text-on-surface"><span class="font-bold text-primary">${MACL.esc(m.label)}</span> endorsed</p>`).join("")
        : `<p class="text-sm text-on-surface-variant italic">No endorsements yet.</p>`;
      const declinerList = r.decliners.length
        ? r.decliners.map((m) => `<p class="text-sm text-on-surface"><span class="font-bold text-error">${MACL.esc(m.label)}</span> declined</p>`).join("")
        : "";
      const remaining = Math.max(0, threshold - count);
      const note = r.rec.finalised
        ? "Threshold reached — record finalised and locked."
        : `${remaining} more endorsement${remaining === 1 ? "" : "s"} needed to finalise (2-of-3). A party may endorse or decline once.`;

      const expand = `<tr class="hidden bg-surface-container-low/50" id="row-${id}">
<td class="px-8 py-6 border-l-4 ${r.rec.finalised ? "border-primary" : declines ? "border-error" : "border-outline-variant"}" colspan="7">
<div class="grid grid-cols-2 gap-12">
<div class="space-y-3">
<h4 class="text-label-caps text-on-surface-variant border-b border-outline-variant pb-2">VERIFICATION STATE (${count}/${total} endorsed · finalises at ${threshold})</h4>
${endorserList}${declinerList}
<p class="text-xs text-on-surface-variant">${note}</p>
</div>
<div class="space-y-4">
<h4 class="text-label-caps text-on-surface-variant border-b border-outline-variant pb-2">LEDGER AUTHENTICITY</h4>
<div class="bg-surface-container-lowest p-4 border border-outline-variant rounded">
<span class="text-[10px] text-on-surface-variant block mb-1">FINALISED BLOCK HASH</span>
<div class="font-code-metadata text-[11px] break-all text-on-surface">${r.rec.finalised ? MACL.esc(r.blockHash) : "— (not finalised)"}</div>
</div>
${MACL.hasHash(r.rec.documentHash) ? `<div class="bg-surface-container-lowest p-4 border border-outline-variant rounded">
<span class="text-[10px] text-on-surface-variant block mb-1">SUPPORTING-DOCUMENT FINGERPRINT (SHA-256)</span>
<div class="font-code-metadata text-[11px] break-all text-on-surface">${MACL.esc(r.rec.documentHash)}</div>
<div class="mt-3 flex flex-wrap items-center gap-2">
<label class="text-xs text-on-surface-variant">Verify a file against this:</label>
<input type="file" data-verifyrec="${id}" onclick="event.stopPropagation()" class="text-xs file:mr-2 file:rounded file:border-0 file:bg-primary-container file:text-white file:px-2 file:py-1 file:text-[11px]"/>
<span class="text-xs font-semibold" id="verifyrec-out-${id}"></span>
</div>
<p class="text-[10px] text-on-surface-variant mt-2">A match proves the document is unchanged since it was recorded — not that it was genuine in the first place.</p>
</div>` : ""}
<div class="grid grid-cols-2 gap-4">
<div><span class="text-[10px] text-on-surface-variant block mb-1">SUBMITTER</span><span class="text-xs font-bold text-on-surface">${MACL.esc(MACL.labelForAddress(r.rec.submitter))}</span></div>
<div><span class="text-[10px] text-on-surface-variant block mb-1">CONSENSUS MODEL</span><span class="text-xs font-bold text-on-surface">QBFT · 2-of-3 endorse</span></div>
<div><span class="text-[10px] text-on-surface-variant block mb-1">EVALUATED</span><span class="text-xs font-bold text-on-surface">${MACL.fmtTs(r.rec.evaluatedAt)}</span></div>
<div><span class="text-[10px] text-on-surface-variant block mb-1">RESULT</span><span class="text-xs font-bold text-on-surface">${label}</span></div>
</div>
</div>
</div>
</td>
</tr>`;
      return summary + expand;
    }).join("");

    body.querySelectorAll("button[data-endorse]").forEach((b) =>
      b.onclick = (e) => { e.stopPropagation(); act("endorse", b.getAttribute("data-endorse")); });
    body.querySelectorAll("button[data-decline]").forEach((b) =>
      b.onclick = (e) => { e.stopPropagation(); act("decline", b.getAttribute("data-decline")); });

    // wire the "Verify document" file inputs (records carrying a documentHash)
    body.querySelectorAll("input[data-verifyrec]").forEach((inp) =>
      inp.onchange = async (e) => {
        e.stopPropagation();
        const rid = inp.getAttribute("data-verifyrec");
        const out = document.getElementById("verifyrec-out-" + rid);
        const row = rows.find((r) => r.rec.id.toString() === rid);
        const file = inp.files[0];
        if (!file || !row) return;
        out.textContent = "Checking…"; out.className = "text-xs font-semibold text-on-surface-variant";
        try {
          const v = await MACL.verifyDocument(file, row.rec.documentHash);
          // Honest framing (decision C): unchanged-since-recorded, not authenticity.
          if (v.match) { out.textContent = "✓ Document verified"; out.title = "Unchanged since recorded — not a proof of authenticity."; out.className = "text-xs font-semibold text-green-700"; }
          else { out.textContent = "✗ Does not match the ledger"; out.className = "text-xs font-semibold text-error"; }
        } catch (err) { out.textContent = MACL.parseError(err); out.className = "text-xs font-semibold text-error"; }
      });
  }

  async function act(kind, id) {
    const { verification } = MACL.contracts(MACL.getRole());
    const label = kind === "endorse" ? `Endorse record #${id}` : `Decline record #${id}`;
    try { await MACL.withTx(label, () => verification[kind](BigInt(id))); }
    catch (_) { return; }
    await load();
  }

  // exports
  document.getElementById("au-pdf").onclick = () => MACL_UI.exportPDF();
  document.getElementById("au-csv").onclick = () => MACL_UI.exportCSV(
    "macl-audit-trail.csv",
    ["recordId", "agreementId", "indicator", "threshold", "unit", "reportedValue", "result", "endorsements", "declines", "finalised", "blockHash", "submitter", "evaluatedAt"],
    rows.map((r) => [
      r.rec.id, r.rec.agreementId, r.target.indicator, r.target.threshold, r.target.unit,
      r.rec.reportedValue, MACL.fmtResult(r.rec.result), `${r.count}/${total}`, r.declines,
      r.rec.finalised, r.blockHash, r.rec.submitter, MACL.fmtTs(r.rec.evaluatedAt),
    ])
  );

  await load();
});
