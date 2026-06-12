/*
 * Overview page — live metrics + recent activity, read straight from chain.
 */
MACL_UI.ready(async () => {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  // Chain id + node dots (single dev node: all three "stakeholder" dots
  // reflect whether the node answers).
  try {
    const cid = await MACL.getChainId();
    set("m-chainid", cid.toString());
    ["node-donor", "node-ngo", "node-govt"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.background = "#4ade80";
    });
  } catch (_) {
    ["node-donor", "node-ngo", "node-govt"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) { el.style.background = "#ba1a1a"; el.style.boxShadow = "none"; }
    });
  }

  // Agreements
  const agreements = await MACL.fetchAgreements();
  const finalisedAg = agreements.filter((r) => r.finalised).length;
  set("m-agreements", agreements.length.toLocaleString());
  set("m-finalised", `${finalisedAg} finalised`);

  // Records
  const records = await MACL.fetchRecords();
  const passCount = records.filter((r) => MACL.fmtResult(r.rec.result) === "PASS").length;
  const finalRecs = records.filter((r) => r.rec.finalised);
  const pending = records.filter((r) => !r.rec.finalised).length;

  set("m-pending", pending.toLocaleString());
  set("m-rate", records.length ? `${Math.round((passCount / records.length) * 100)}%` : "—");
  set("m-rate-note", records.length ? `${passCount}/${records.length} reports PASS` : "no reports yet");
  set("m-records", records.length.toLocaleString());
  set("m-records-final", finalRecs.length.toLocaleString());

  // Latest finalised block hash
  const latest = finalRecs.find((r) => r.blockHash && !/^0x0{64}$/.test(r.blockHash));
  set("m-latesthash", latest ? MACL.fmtHash(latest.blockHash) : "—");

  // Recent activity table (newest records first)
  const tbody = document.getElementById("ov-activity");
  if (tbody) {
    if (!records.length) {
      tbody.innerHTML =
        `<tr><td class="px-6 py-6 text-sm text-on-surface-variant" colspan="5">No reports yet. Start in the Donor-Admin view.</td></tr>`;
    } else {
      const pill = (label) => {
        const c = { PASS: "bg-green-100 text-green-800", FAIL: "bg-red-100 text-red-800",
                    FLAG: "bg-amber-100 text-amber-800", PENDING: "bg-surface-container-high text-on-surface-variant" }[label];
        return `<span class="px-2 py-1 ${c} text-[10px] font-bold rounded uppercase tracking-wider">${label}</span>`;
      };
      tbody.innerHTML = records.slice(0, 8).map((r) => {
        const label = MACL.fmtResult(r.rec.result);
        return `<tr class="hover:bg-surface-container-low transition-colors group">
<td class="px-6 py-4">
<div class="font-code-metadata text-primary">Record #${r.rec.id}</div>
<div class="text-[10px] text-outline font-code-metadata truncate w-28">${MACL.fmtHash(r.blockHash)}</div>
</td>
<td class="px-6 py-4 font-body-sm">${MACL.esc(MACL.labelForAddress(r.rec.submitter))}</td>
<td class="px-6 py-4 font-code-metadata text-xs">${MACL.fmtTs(r.rec.evaluatedAt)}</td>
<td class="px-6 py-4">${pill(label)}</td>
<td class="px-6 py-4 text-right">${r.rec.finalised ? '<span class="material-symbols-outlined text-primary text-sm">lock</span>' : ''}</td>
</tr>`;
      }).join("");
    }
  }

  // Export Ledger → CSV of all records
  const btn = document.getElementById("ov-export");
  if (btn) {
    btn.onclick = () => {
      MACL_UI.exportCSV(
        "macl-ledger.csv",
        ["recordId", "agreementId", "targetIndex", "indicator", "reportedValue", "threshold", "unit", "result", "endorsements", "finalised", "blockHash", "submitter", "evaluatedAt"],
        records.map((r) => [
          r.rec.id, r.rec.agreementId, r.rec.targetIndex, r.target.indicator,
          r.rec.reportedValue, r.target.threshold, r.target.unit,
          MACL.fmtResult(r.rec.result), `${r.count}/${MACL.cfg.ENDORSEMENT_THRESHOLD}`,
          r.rec.finalised, r.blockHash, r.rec.submitter, MACL.fmtTs(r.rec.evaluatedAt),
        ])
      );
    };
  }
});
