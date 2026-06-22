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

    // fetchRecords already resolves r.endorsers / r.decliners (role-meta arrays)
    // from the API. Add the integrity badge (cross-node check, proxied by the API).
    for (const r of rows) {
      r.integrity = await MACL.verifyRecord({ kind: "record", id: r.rec.id });
    }

    const pass = rows.filter((r) => MACL.fmtResult(r.rec.result) === "PASS").length;
    const pending = rows.filter((r) => !r.rec.finalised && !r.rec.unverified).length;
    set("au-total", rows.length.toLocaleString());
    set("au-pending", pending.toLocaleString());
    set("au-rate", rows.length ? `${Math.round((pass / rows.length) * 100)}%` : "—");
    set("au-rate-note", rows.length ? `${pass}/${rows.length} reports PASS` : "no reports yet");
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
    return `<span data-help="${label.toLowerCase()}" class="px-2 py-1 ${c} text-[10px] font-bold rounded">${label}</span>`;
  };
  // Integrity badge — driven by MACL.verifyRecord. On Besu it reports cross-node
  // agreement (how many of the 3 nodes hold an identical copy); on the single
  // local node it just confirms the record is on the ledger. Shown on finalised records.
  const integrityBadge = (integ) => {
    if (!integ || !integ.ok) {
      return `<span class="inline-flex items-center gap-1 text-[10px] text-error mt-1" title="${MACL.esc(integ ? integ.detail : "unverifiable")}"><span class="material-symbols-outlined text-xs">error</span>${MACL.esc(integ ? integ.label : "Unverifiable")}</span>`;
    }
    if (integ.nodes) {
      const { agree, total } = integ.nodes;
      const all = agree === total, maj = agree >= 2; // 2-of-3 majority
      const cls = all ? "text-primary" : maj ? "text-amber-600" : "text-error";
      const icon = all ? "verified" : maj ? "warning" : "error";
      const text = all ? `verified across ${total} nodes` : `${agree} of ${total} nodes agree`;
      const detail = all
        ? "All three nodes hold an identical copy of this record."
        : `Only ${agree} of ${total} nodes hold this record — the rest are out of sync or unreachable. The 2-of-3 majority record stands.`;
      return `<span class="inline-flex items-center gap-1 text-[10px] ${cls} mt-1" title="${MACL.esc(detail)}"><span class="material-symbols-outlined text-xs">${icon}</span>${text}</span>`;
    }
    return `<span class="inline-flex items-center gap-1 text-[10px] text-primary mt-1" title="${MACL.esc(integ.detail)}"><span class="material-symbols-outlined text-xs">verified</span>${MACL.esc(integ.label)}</span>`;
  };

  // Client-side search/filter over the records already fetched (proposal §3.5 "searchable").
  function statusKey(r) {
    if (r.rec.finalised) return "finalised";
    if (r.rec.unverified) return "unverified";
    if (Number(r.declines) > 0) return "disputed";
    return "pending";
  }
  function filteredRows() {
    const el = (id) => document.getElementById(id);
    const q = ((el("au-search") && el("au-search").value) || "").trim().toLowerCase();
    const fr = (el("au-filter-result") && el("au-filter-result").value) || "";
    const fs = (el("au-filter-status") && el("au-filter-status").value) || "";
    return rows.filter((r) => {
      if (fr && MACL.fmtResult(r.rec.result) !== fr) return false;
      if (fs && statusKey(r) !== fs) return false;
      if (q) {
        const hay = `record #${r.rec.id} agreement #${r.rec.agreementId} ${r.target.indicator}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function renderTable() {
    const body = document.getElementById("au-rows");
    const list = filteredRows();
    set("au-count", rows.length === list.length
      ? `${rows.length} record${rows.length === 1 ? "" : "s"}`
      : `${list.length} of ${rows.length} records`);
    if (!rows.length) {
      body.innerHTML = `<tr><td class="px-6 py-6 text-sm text-on-surface-variant" colspan="7">No records yet. Once the NGO submits its first report, the verification trail appears here.</td></tr>`;
      return;
    }
    if (!list.length) {
      body.innerHTML = `<tr><td class="px-6 py-6 text-sm text-on-surface-variant" colspan="7">No records match your search or filters.</td></tr>`;
      return;
    }
    const acting = MACL.getRole();
    const actingLabel = MACL.roleMeta(acting).label;

    body.innerHTML = list.map((r) => {
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
        status = `<div class="flex flex-col"><span data-help="finalise" class="flex items-center gap-1.5 text-xs text-primary font-bold"><span class="material-symbols-outlined text-sm">lock</span>Finalised</span>${integrityBadge(r.integrity)}</div>`;
      } else if (r.rec.unverified) {
        // BL-9: terminal — the window passed and it was marked unverified.
        status = `<span data-help="unverified" class="flex items-center gap-1.5 text-xs text-error font-bold"><span class="material-symbols-outlined text-sm">gpp_bad</span>Unverified</span>`;
      } else if (r.expired) {
        // BL-9: window passed, not finalised, not yet marked — needs marking.
        status = `<span data-help="expired" class="flex items-center gap-1.5 text-xs text-amber-600 font-bold"><span class="material-symbols-outlined text-sm">schedule</span>Window passed</span>`;
      } else if (declines > 0) {
        status = `<span class="flex items-center gap-1.5 text-xs text-error font-bold"><span class="material-symbols-outlined text-sm">warning</span>Disputed (${declines})</span>`;
      } else {
        status = `<span class="flex items-center gap-1.5 text-xs text-secondary"><span class="w-2 h-2 rounded-full bg-secondary"></span>In Progress</span>`;
      }
      // Actions only on a still-live record (not finalised, not already unverified).
      if (!r.rec.finalised && !r.rec.unverified) {
        if (r.expired) {
          // The window has passed: the only action left is to record the terminal UNVERIFIED state.
          action = `<div class="flex gap-1 mt-1 no-print">
<button data-expire="${id}" data-perm="record.endorse" data-help="unverified" onclick="event.stopPropagation()" class="border border-error text-error px-2.5 py-1 rounded text-xs font-semibold hover:bg-error hover:text-white active:scale-95 transition-all">Mark unverified</button>
</div>`;
        } else if (r.endorsedByActing) action = `<span class="text-[10px] text-on-surface-variant block mt-1">${MACL.esc(actingLabel)} endorsed</span>`;
        else if (r.declinedByActing) action = `<span class="text-[10px] text-error block mt-1">${MACL.esc(actingLabel)} declined</span>`;
        else action = `<div class="flex gap-1 mt-1 no-print">
<button data-endorse="${id}" data-perm="record.endorse" data-help="endorse" onclick="event.stopPropagation()" class="bg-primary text-white px-2.5 py-1 rounded text-xs font-semibold hover:opacity-90 active:scale-95 transition-all">Endorse</button>
<button data-decline="${id}" data-perm="record.decline" data-help="decline" onclick="event.stopPropagation()" class="border border-error text-error px-2.5 py-1 rounded text-xs font-semibold hover:bg-error hover:text-white active:scale-95 transition-all">Decline</button>
</div>`;
      }
      // A finalised record can still take a 3rd endorsement for a complete audit trail
      // (proposal §5.3): Endorse only (no decline), only for a signatory who hasn't acted yet.
      if (r.rec.finalised && !r.endorsedByActing && !r.declinedByActing) {
        action = `<div class="flex gap-1 mt-1 no-print">
<button data-endorse="${id}" data-perm="record.endorse" data-help="endorse" title="Add your endorsement for the audit trail — the record is already finalised, this won't change its status." onclick="event.stopPropagation()" class="border border-primary text-primary px-2.5 py-1 rounded text-xs font-semibold hover:bg-primary hover:text-white active:scale-95 transition-all">Endorse for the record</button>
</div>`;
      }

      const summary = `<tr class="hover:bg-surface-container-low cursor-pointer transition-colors group" onclick="toggleRow('row-${id}')">
<td class="px-6 py-5"><div class="flex flex-col"><span class="font-semibold text-on-surface">Record #${id}</span><span class="text-xs text-on-surface-variant font-code-metadata">Agreement #${r.rec.agreementId}</span></div></td>
<td class="px-6 py-5 text-on-surface-variant">${MACL.esc(r.target.indicator)} ≥ ${r.target.threshold} ${MACL.esc(r.target.unit)}</td>
<td class="px-6 py-5 font-code-metadata text-on-surface">${r.rec.reportedValue} ${MACL.esc(r.target.unit)}</td>
<td class="px-6 py-5">${pill(label)}</td>
<td class="px-6 py-5"><div class="flex items-center gap-2"><div class="flex -space-x-2">${avatars}</div><span data-help="2of3" class="text-xs font-medium text-on-surface-variant">${count}/${total} endorsed</span></div>${declines ? `<span class="text-[10px] text-error">${declines} declined</span>` : ""}</td>
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
<span data-help="blockhash" class="text-[10px] text-on-surface-variant block mb-1">FINALISED BLOCK HASH</span>
<div class="font-code-metadata text-[11px] break-all text-on-surface">${r.rec.finalised ? MACL.esc(r.blockHash) : "— (not finalised)"}</div>
</div>
${MACL.hasHash(r.rec.documentHash) ? `<div class="bg-surface-container-lowest p-4 border border-outline-variant rounded">
<span class="text-[10px] text-on-surface-variant block mb-1">SUPPORTING-DOCUMENT FINGERPRINT (SHA-256)</span>
<div class="font-code-metadata text-[11px] break-all text-on-surface">${MACL.esc(r.rec.documentHash)}</div>
<div class="mt-3 flex flex-wrap items-center gap-2">
<a href="#" onclick="event.stopPropagation(); MACL_UI.viewDoc('${r.rec.documentHash}'); return false;" class="text-xs text-primary font-semibold hover:underline">View</a>
<button type="button" data-verify-stored="${r.rec.documentHash}" data-out="verifyrec-out-${id}" onclick="event.stopPropagation()" class="text-xs text-primary font-semibold hover:underline">Verify</button>
<span class="text-xs font-semibold" id="verifyrec-out-${id}"></span>
</div>
<p class="text-[10px] text-on-surface-variant mt-2">Verify re-hashes the stored file on the server against the on-chain hash: a match proves it is unchanged since recorded — not that it was genuine in the first place.</p>
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
    body.querySelectorAll("button[data-expire]").forEach((b) =>
      b.onclick = (e) => { e.stopPropagation(); act("markUnverified", b.getAttribute("data-expire")); });

    // wire the one-click View/Verify controls (BL-14)
    MACL_UI.wireVerify(body);
  }

  async function act(kind, id) {
    const { verification } = MACL.contracts(MACL.getRole());
    const label = { endorse: `Endorse record #${id}`, decline: `Decline record #${id}`,
                    markUnverified: `Mark record #${id} unverified` }[kind];
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

  // Re-render as the auditor searches/filters (client-side; the stat cards stay full-ledger).
  ["au-search", "au-filter-result", "au-filter-status"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", renderTable);
  });

  await load();
});
