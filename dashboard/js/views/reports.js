/*
 * Reports page — submit a compliance report against a finalised target.
 * The contract evaluates PASS/FAIL/FLAG; we read the result from the
 * emitted RecordEvaluated event (no client-side simulation).
 */
MACL_UI.ready(async () => {
  const acting = MACL.getRole();

  // Role scoping: only the NGO submits reports. Donor/Audit don't submit, so hide the form and
  // replace the (always-empty) "Past Reports" table with a pointer to the Audit Trail — their
  // shared full view of all records (proposal §3.5).
  if (!MACL.can("report.submit")) {
    const form = document.getElementById("rp-form-section");
    const side = document.getElementById("rp-side");
    if (form) form.style.display = "none";
    if (side) side.classList.replace("lg:col-span-7", "lg:col-span-12");
    const past = document.getElementById("rp-past-section");
    if (past) past.innerHTML = `<div class="flex items-start gap-3">
<span class="material-symbols-outlined text-primary">history_edu</span>
<div>
<h3 class="font-title-sm text-title-sm text-primary">Compliance records</h3>
<p class="text-body-sm text-on-surface-variant mt-1">Your organisation doesn't submit reports. View the full record of all compliance reports on the <a href="audit.html" class="text-primary font-semibold hover:underline">Audit Trail →</a></p>
</div>
</div>`;
  }

  let finalised = []; // finalised agreements with targets, for the cascade
  let pendingHash = null; // SHA-256 of an optional evidence file (hashed server-side)

  // Upload any attached evidence to the server, which returns its SHA-256 for the chain.
  const fileInput = document.getElementById("rp-file");
  if (fileInput) {
    fileInput.addEventListener("change", async (e) => {
      const out = document.getElementById("rp-filehash");
      const file = e.target.files[0];
      if (!file) { pendingHash = null; out.textContent = "Optional — no file selected."; return; }
      out.textContent = "Uploading & hashing on the server…";
      try {
        // Store the evidence (BL-12); the server returns its SHA-256 for the chain.
        pendingHash = (await MACL.uploadDocument(file)).hash;
        out.innerHTML = `Stored · SHA-256 on-chain: <span class="text-primary">${pendingHash}</span>`;
      } catch (err) { pendingHash = null; out.textContent = "Could not store file: " + MACL.parseError(err); }
    });
  }

  // A recognisable label for an agreement (lead with the first target's indicator + years),
  // matching the Budget & Spend dropdowns so the submitter can tell programmes apart.
  function agreementLabel(r) {
    const ts = r.targets || [];
    const ind = ts.length ? (ts[0].indicator || "target") : "—";
    const short = ind.length > 24 ? ind.slice(0, 23) + "…" : ind;
    const what = ts.length > 1 ? `${short} (+${ts.length - 1} more)` : short;
    const yr = (d) => new Date(Number(d) * 1000).getFullYear();
    return `#${r.id} · ${what} · ${yr(r.a.startDate)}→${yr(r.a.endDate)}`;
  }

  // --- populate agreement select (finalised only)
  async function loadSelects() {
    const all = await MACL.fetchAgreements();
    finalised = all.filter((r) => r.finalised && r.targets.length);
    const agSel = document.getElementById("agreement");
    agSel.innerHTML = finalised.length
      ? `<option disabled selected value="">Choose a finalised agreement…</option>` +
        finalised.map((r) => `<option value="${r.id}">${MACL.esc(agreementLabel(r))}</option>`).join("")
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
    const unitEl = document.getElementById("value-unit");
    if (unitEl) unitEl.textContent = t ? t.unit : "";
    const info = document.getElementById("target-info");
    if (!t) { info.innerHTML = ""; return; }
    const past = Number(t.deadline) * 1000 < Date.now();
    info.innerHTML = `Needs <b>≥ ${t.threshold} ${MACL.esc(t.unit)}</b> by ${MACL.fmtTs(t.deadline)}`
      + (past ? ` <span class="text-amber-600 font-semibold">— deadline passed; meeting it now will be FLAGGED.</span>` : "");
  }

  // --- past reports by the acting account
  async function loadPast() {
    const tbody = document.getElementById("rp-rows");
    if (!tbody) return; // non-NGO: the Past Reports table is replaced by a pointer callout
    const mine = MACL.roleMeta().address.toLowerCase();
    const rows = (await MACL.fetchRecords()).filter((r) => r.rec.submitter.toLowerCase() === mine);
    if (!rows.length) {
      // Role-aware empty state: the NGO can still submit ("yet"); the Donor/Audit never submit,
      // so don't imply they might — point them to the full record instead.
      const msg = MACL.can("report.submit")
        ? `No reports submitted by ${MACL.esc(MACL.roleMeta().label)} yet.`
        : `Only the NGO submits reports — see the <a href="audit.html" class="text-primary hover:underline">Audit Trail</a> for the full record of all reports.`;
      tbody.innerHTML = `<tr><td class="px-6 py-6 text-sm text-on-surface-variant" colspan="7">${msg}</td></tr>`;
      return;
    }
    const pillClass = { PASS: "status-pill-pass", FAIL: "status-pill-fail", FLAG: "status-pill-flag", PENDING: "" };
    tbody.innerHTML = rows.map((r) => {
      const label = MACL.fmtResult(r.rec.result);
      const id = r.rec.id.toString();
      // Evidence cell: one-click View (open the stored file) / Verify (server re-hashes
      // the stored file against the on-chain hash). BL-14 — no file picking.
      const evidence = MACL.hasHash(r.rec.documentHash)
        ? `<div class="flex flex-col gap-1">
<span class="font-code-metadata text-[11px] text-on-surface-variant" title="${MACL.esc(r.rec.documentHash)}">${MACL.fmtHash(r.rec.documentHash)}</span>
<div class="flex items-center gap-2">
<a href="#" onclick="MACL_UI.viewDoc('${r.rec.documentHash}'); return false;" class="text-[10px] text-primary hover:underline">View</a>
<button type="button" data-verify-stored="${r.rec.documentHash}" data-out="rp-verify-${id}" class="text-[10px] text-primary hover:underline">Verify</button>
<span class="text-[10px] font-semibold" id="rp-verify-${id}"></span>
</div>
</div>`
        : `<span class="text-xs text-on-surface-variant">—</span>`;
      return `<tr class="hover:bg-surface-container-low transition-colors">
<td class="px-6 py-5 border-b border-outline-variant font-code-metadata text-xs text-primary">#${id}</td>
<td class="px-6 py-5 border-b border-outline-variant font-body-sm">Agreement #${r.rec.agreementId}</td>
<td class="px-6 py-5 border-b border-outline-variant font-body-sm">${MACL.esc(r.target.indicator)}: ${r.rec.reportedValue} ${MACL.esc(r.target.unit)}</td>
<td class="px-6 py-5 border-b border-outline-variant"><span data-help="${label.toLowerCase()}" class="${pillClass[label]} px-3 py-1 rounded-full text-[10px] font-bold">${label}</span></td>
<td class="px-6 py-5 border-b border-outline-variant"><div class="flex items-center gap-1 text-on-surface-variant"><span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1;">star</span><span class="font-body-sm">${r.count}/${MACL.cfg.ENDORSEMENT_THRESHOLD}</span></div></td>
<td class="px-6 py-5 border-b border-outline-variant">${evidence}</td>
<td class="px-6 py-5 border-b border-outline-variant text-right text-body-sm text-on-surface-variant">${MACL.fmtTs(r.rec.evaluatedAt).slice(0, 16)}</td>
</tr>`;
    }).join("");

    // wire the one-click View/Verify controls (BL-14)
    MACL_UI.wireVerify(tbody);
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
    try {
      receipt = await MACL.withTx("Submit report", () =>
        // Use the documentHash overload only when evidence was attached; otherwise
        // call the plain 3-arg version (which stores a zero hash).
        pendingHash
          ? compliance["submitReport(uint256,uint256,uint256,bytes32)"](BigInt(id), BigInt(idx), BigInt(val), pendingHash)
          : compliance.submitReport(BigInt(id), BigInt(idx), BigInt(val)));
    } catch (_) { return; }
    pendingHash = null;
    if (fileInput) fileInput.value = "";
    const fh = document.getElementById("rp-filehash");
    if (fh) fh.textContent = "Optional — no file selected.";

    // Clear the entry fields for the next report (the result card below stays as confirmation).
    document.getElementById("value").value = "";
    document.getElementById("agreement").selectedIndex = 0;
    onPickAgreement(); // resets the dependent target dropdown
    const vu = document.getElementById("value-unit"); if (vu) vu.textContent = "";
    const ti = document.getElementById("target-info"); if (ti) ti.innerHTML = "";

    // the API returns the on-chain evaluation (parsed from the RecordEvaluated event)
    showResult(MACL.fmtResult(receipt.result), receipt.recordId, receipt);
    await loadPast();
  });

  // Starting a new entry hides the previous result card, so a stale result never lingers over
  // fresh input. (The programmatic resets above don't fire 'input', so the card survives submit.)
  document.getElementById("reportForm").addEventListener("input", () => {
    const card = document.getElementById("resultCard");
    if (card) card.classList.add("hidden");
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
  await loadPast();
});
