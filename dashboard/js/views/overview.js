/*
 * Overview page — live metrics + recent activity, read straight from chain.
 */
MACL_UI.ready(async () => {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  // Latest block number (Network Integrity card) — proposal §3.2 wants it shown.
  try { set("m-latestblock", `#${(await MACL.ping()).toLocaleString()}`); } catch (_) {}

  // -------- Network Integrity panel (Part 4) --------
  // On Besu it queries all three node RPCs and shows each as in-sync / behind /
  // diverged / not-responding. On the single local node there's nothing to
  // cross-check, so it just shows that one node's reachability. It refreshes on
  // a timer so the tamper demo (a node going out of sync) is visible live.
  const DOT = { sync: "#4ade80", behind: "#f1c40f", fork: "#ba1a1a", down: "#ba1a1a" };
  const WORD = { sync: "in sync", behind: "behind", fork: "diverged", down: "not responding" };

  async function renderIntegrity() {
    const host = document.getElementById("ov-nodes");
    const sync = document.getElementById("ov-sync");
    if (!host) return;

    const r = await MACL.getNodeStates();
    host.innerHTML = r.states.map((s) =>
      `<div class="flex items-center justify-between">
         <span class="flex items-center gap-2 font-code-metadata text-[11px]"><span class="w-2.5 h-2.5 rounded-full" style="background:${DOT[s.status]}"></span>${MACL.esc(s.label)}</span>
         <span class="font-code-metadata text-[10px] opacity-70">${s.ok ? `#${s.height} · ${WORD[s.status]}` : WORD[s.status]}</span>
       </div>`).join("");
    if (r.inSync) { sync.textContent = `✓ ${r.reachable}/${r.total} in sync`; sync.style.color = "#4ade80"; }
    else { sync.textContent = `${r.reachable}/${r.total} responding`; sync.style.color = "#f1c40f"; }
  }
  await renderIntegrity();
  setInterval(renderIntegrity, 4000);

  // Agreements
  const agreements = await MACL.fetchAgreements();
  const finalisedAg = agreements.filter((r) => r.finalised).length;
  set("m-agreements", agreements.length.toLocaleString());
  set("m-finalised", `${finalisedAg} agreements finalised`);

  // Records (pass the acting address so we know what THIS org has endorsed)
  const acting = MACL.roleMeta();
  const records = await MACL.fetchRecords(acting ? acting.address : null);
  const finalRecs = records.filter((r) => r.rec.finalised);
  // "Pending" = still in progress: neither finalised nor terminally unverified (BL-9).
  const pending = records.filter((r) => !r.rec.finalised && !r.rec.unverified).length;

  set("m-pending", pending.toLocaleString());
  // Progress bar reflects real data: how much of the ledger is still pending
  // endorsement (0% on an empty chain, not the old hard-coded 66%).
  const bar = document.getElementById("m-pending-bar");
  if (bar) bar.style.width = records.length ? `${Math.round((pending / records.length) * 100)}%` : "0%";
  set("m-records", records.length.toLocaleString());
  set("m-records-final", finalRecs.length.toLocaleString());

  // Latest finalised block hash
  const latest = finalRecs.find((r) => r.blockHash && !/^0x0{64}$/.test(r.blockHash));
  set("m-latesthash", latest ? MACL.fmtHash(latest.blockHash) : "—");

  // -------- Needs your action (BL-15) --------
  // What is waiting on the LOGGED-IN org right now: reports/spend awaiting its
  // endorsement, and (for the creator) agreements ready to finalise.
  async function renderActions() {
    const host = document.getElementById("ov-actions");
    if (!host || !acting) return;
    const me = acting.address.toLowerCase();
    document.getElementById("ov-actions-org").textContent = `Signed in as ${acting.label}`;

    // agreementId -> { signatories Set, creator } (from the agreements we already fetched)
    const agInfo = {};
    for (const a of agreements) {
      agInfo[a.id] = {
        sigs: new Set((a.a.signatories || []).map((s) => s.toLowerCase())),
        creator: a.a.creator.toLowerCase(),
      };
    }
    const total = Object.keys(MACL.cfg.ROLES).length;
    const threshold = MACL.cfg.ENDORSEMENT_THRESHOLD;
    const actions = [];

    // Reports awaiting this org's endorsement, or (BL-9) stale reports to mark unverified
    for (const r of records) {
      if (r.rec.finalised || r.rec.unverified) continue;
      const info = agInfo[r.rec.agreementId.toString()];
      if (!info || !info.sigs.has(me)) continue;
      if (r.expired) {
        actions.push({ icon: "schedule", href: "audit.html", cta: "Review",
          text: `Report #${r.rec.id}'s verification window has passed — mark it unverified` });
      } else if (!r.endorsedByActing && !r.declinedByActing) {
        actions.push({ icon: "how_to_reg", href: "audit.html", cta: "Review",
          text: `Report #${r.rec.id} (agreement #${r.rec.agreementId}) is waiting for your endorsement` });
      }
    }
    // Spend requests awaiting this org's approval (can't approve your own)
    let spend = [];
    try { spend = await MACL.fetchSpendRequests(acting.address); } catch (_) {}
    for (const s of spend) {
      if (s.req.approved || s.req.spent) continue;
      if (Number(s.declines) > total - threshold) continue; // already rejected
      const info = agInfo[s.req.agreementId.toString()];
      if (info && info.sigs.has(me) && s.req.requester.toLowerCase() !== me && !s.endorsedByActing && !s.declinedByActing) {
        actions.push({ icon: "paid", href: "spend.html", cta: "Review",
          text: `Spend request #${s.req.id} (${MACL.fmtMoney(s.req.amount)}) needs your approval` });
      }
    }
    // Agreements you created that have targets but aren't finalised yet
    for (const a of agreements) {
      if (!a.finalised && a.a.creator.toLowerCase() === me && a.targets.length > 0) {
        actions.push({ icon: "lock", href: "agreements.html", cta: "Open",
          text: `Agreement #${a.id} has targets but isn't finalised yet` });
      }
    }

    host.innerHTML = actions.length
      ? actions.map((a) =>
          `<div class="flex items-center justify-between gap-4 py-2.5 border-b border-outline-variant last:border-0">
<span class="flex items-center gap-3 text-sm text-on-surface"><span class="material-symbols-outlined text-primary text-base">${a.icon}</span>${MACL.esc(a.text)}</span>
<a href="${a.href}" class="text-sm font-semibold text-primary hover:underline whitespace-nowrap">${a.cta} →</a>
</div>`).join("")
      : `<p class="text-sm text-on-surface-variant flex items-center gap-2"><span class="material-symbols-outlined text-green-600 text-base">check_circle</span>You're all caught up — nothing needs your action right now.</p>`;
  }
  await renderActions();

  // Recent activity table (newest records first)
  const tbody = document.getElementById("ov-activity");
  if (tbody) {
    if (!records.length) {
      tbody.innerHTML =
        `<tr><td class="px-6 py-6 text-sm text-on-surface-variant" colspan="5">No reports yet. Sign in as the Donor-Admin to create an agreement, then as the NGO to submit the first report.</td></tr>`;
    } else {
      const pill = (label) => {
        const c = { PASS: "bg-green-100 text-green-800", FAIL: "bg-red-100 text-red-800",
                    FLAG: "bg-amber-100 text-amber-800", PENDING: "bg-surface-container-high text-on-surface-variant" }[label];
        return `<span data-help="${label.toLowerCase()}" class="px-2 py-1 ${c} text-[10px] font-bold rounded uppercase tracking-wider">${label}</span>`;
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
<td class="px-6 py-4 text-right">${
          r.rec.finalised ? '<span class="material-symbols-outlined text-primary text-sm" title="Finalised">lock</span>'
          : r.rec.unverified ? '<span class="material-symbols-outlined text-error text-sm" data-help="unverified">gpp_bad</span>'
          : r.expired ? '<span class="material-symbols-outlined text-amber-600 text-sm" data-help="expired">schedule</span>'
          : ''
        }</td>
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
