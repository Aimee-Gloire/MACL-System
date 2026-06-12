/*
 * Reports page — submit a compliance report against a finalised target.
 * The contract evaluates PASS/FAIL/FLAG; we read the result from the
 * emitted RecordEvaluated event (no client-side simulation).
 */
MACL_UI.ready(async () => {
  const acting = MACL.getRole();
  document.getElementById("rp-breadcrumb").textContent = MACL.roleMeta(acting).label + " Console";

  let finalised = []; // finalised agreements with targets, for the cascade

  // --- populate agreement select (finalised only)
  async function loadSelects() {
    const all = await MACL.fetchAgreements();
    finalised = all.filter((r) => r.finalised && r.targets.length);
    const agSel = document.getElementById("agreement");
    agSel.innerHTML = finalised.length
      ? `<option disabled selected value="">Choose a finalised agreement…</option>` +
        finalised.map((r) => `<option value="${r.id}">Agreement #${r.id} (${r.targets.length} target${r.targets.length === 1 ? "" : "s"})</option>`).join("")
      : `<option disabled selected value="">No finalised agreements yet</option>`;
    agSel.onchange = onPickAgreement;
  }

  function onPickAgreement() {
    const id = document.getElementById("agreement").value;
    const tSel = document.getElementById("target");
    const ag = finalised.find((r) => r.id === id);
    if (!ag) { tSel.innerHTML = `<option value="">—</option>`; return; }
    tSel.innerHTML = ag.targets.map((t, i) => `<option value="${i}">[${i}] ${MACL.esc(t.indicator)}</option>`).join("");
    tSel.onchange = showTargetInfo;
    showTargetInfo();
  }
  function showTargetInfo() {
    const id = document.getElementById("agreement").value;
    const idx = document.getElementById("target").value;
    const ag = finalised.find((r) => r.id === id);
    const t = ag && ag.targets[Number(idx)];
    document.getElementById("target-info").innerHTML = t
      ? `Needs <b>≥ ${t.threshold} ${MACL.esc(t.unit)}</b> by ${MACL.fmtTs(t.deadline)}`
      : "";
  }

  // --- recent blocks (honest replacement for the fake "Real-time Chain")
  async function loadBlocks() {
    const host = document.getElementById("rp-blocks");
    if (!host) return;
    const head = await MACL.ping();
    const nums = [head, head - 1, head - 2].filter((n) => n >= 0);
    const blks = await Promise.all(nums.map((n) => MACL.provider.getBlock(n)));
    host.innerHTML = blks.map((b) =>
      `<div class="flex justify-between items-center border-b border-white/10 pb-2">
        <span class="text-[10px] font-code-metadata opacity-60">BLOCK #${b.number}</span>
        <span class="text-[10px] font-code-metadata">${b.transactions.length} tx</span>
      </div>`).join("");
  }

  // --- past reports by the acting account
  async function loadPast() {
    const tbody = document.getElementById("rp-rows");
    const mine = MACL.roleMeta().address.toLowerCase();
    const rows = (await MACL.fetchRecords()).filter((r) => r.rec.submitter.toLowerCase() === mine);
    if (!rows.length) {
      tbody.innerHTML = `<tr><td class="px-6 py-6 text-sm text-on-surface-variant" colspan="6">No reports submitted by ${MACL.esc(MACL.roleMeta().label)} yet.</td></tr>`;
      return;
    }
    const pillClass = { PASS: "status-pill-pass", FAIL: "status-pill-fail", FLAG: "status-pill-flag", PENDING: "" };
    tbody.innerHTML = rows.map((r) => {
      const label = MACL.fmtResult(r.rec.result);
      return `<tr class="hover:bg-surface-container-low transition-colors">
<td class="px-6 py-5 border-b border-outline-variant font-code-metadata text-xs text-primary">#${r.rec.id}</td>
<td class="px-6 py-5 border-b border-outline-variant font-body-sm">Agreement #${r.rec.agreementId}</td>
<td class="px-6 py-5 border-b border-outline-variant font-body-sm">${MACL.esc(r.target.indicator)}: ${r.rec.reportedValue} ${MACL.esc(r.target.unit)}</td>
<td class="px-6 py-5 border-b border-outline-variant"><span class="${pillClass[label]} px-3 py-1 rounded-full text-[10px] font-bold">${label}</span></td>
<td class="px-6 py-5 border-b border-outline-variant"><div class="flex items-center gap-1 text-on-surface-variant"><span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1;">star</span><span class="font-body-sm">${r.count}/${MACL.cfg.ENDORSEMENT_THRESHOLD}</span></div></td>
<td class="px-6 py-5 border-b border-outline-variant text-right text-body-sm text-on-surface-variant">${MACL.fmtTs(r.rec.evaluatedAt).slice(0, 16)}</td>
</tr>`;
    }).join("");
  }

  // --- submit
  document.getElementById("reportForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("agreement").value;
    const idx = document.getElementById("target").value;
    const val = document.getElementById("value").value.trim();
    if (!id) return MACL.toast("No agreement", "Choose a finalised agreement.", "err");
    if (idx === "") return MACL.toast("No target", "Choose a target.", "err");
    if (val === "") return MACL.toast("No value", "Enter a reported value.", "err");

    const { compliance } = MACL.contracts(MACL.getRole());
    let receipt;
    try { receipt = await MACL.withTx("Submit report", () => compliance.submitReport(BigInt(id), BigInt(idx), BigInt(val))); }
    catch (_) { return; }

    // read the on-chain evaluation from the RecordEvaluated event
    let result = null, recordId = null;
    for (const log of receipt.logs) {
      try { const p = compliance.interface.parseLog(log); if (p && p.name === "RecordEvaluated") { result = Number(p.args.result); recordId = p.args.recordId; } } catch (_) {}
    }
    showResult(MACL.fmtResult(result), recordId, receipt);
    await loadPast();
    await loadBlocks();
  });

  function showResult(label, recordId, receipt) {
    const card = document.getElementById("resultCard");
    const status = document.getElementById("resultStatus");
    const icon = document.getElementById("resultIcon");
    const sicon = document.getElementById("statusIcon");
    const msg = document.getElementById("resultMsg");
    card.classList.remove("hidden");
    const theme = {
      PASS: ["#065f46", "#d1fae5", "check_circle", "Ledger commitment successful — reported value meets the target."],
      FAIL: ["#991b1b", "#fee2e2", "cancel", "Compliance failure — reported value is below the agreed threshold."],
      FLAG: ["#92400e", "#fef3c7", "report", "Flagged — threshold met but reported after the deadline; needs review."],
      PENDING: ["#515f74", "#e1e3e1", "hourglass_empty", "Recorded."],
    }[label] || ["#515f74", "#e1e3e1", "info", "Recorded."];
    status.innerText = label;
    status.className = "font-headline-md text-headline-md uppercase font-bold tracking-tight";
    status.style.color = theme[0];
    icon.style.backgroundColor = theme[1];
    icon.style.color = theme[0];
    sicon.innerText = theme[2];
    msg.innerText = `Record #${recordId} · ${theme[3]} (block #${receipt.blockNumber})`;
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  await loadSelects();
  await loadBlocks();
  await loadPast();
});
