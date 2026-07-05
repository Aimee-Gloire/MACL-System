# MACL — Results, Analysis, Discussion and Recommendations

This document reports the evaluation results for the MACL system and analyses them against the
objectives set out in the research proposal. It covers the three RQ3 metrics, an analysis of which
objectives were achieved or narrowed, a discussion of why the milestones matter, and recommendations
for the community and for future work.

---

## 1. Evaluation results (RQ3)

MACL was compared against a centralised PostgreSQL baseline holding the same programme data. The
same tamper was applied to each system, and three metrics were recorded (see `evaluation/`, output
in `evaluation/results/metrics.md`).

| Metric | MACL (Besu, 3 nodes) | PostgreSQL baseline | Better |
| --- | --- | --- | --- |
| Tamper-detection latency | Detected in ~204 ms by cross-node comparison | Undetected — the altered value silently became the new truth | **MACL** |
| Audit-trail completeness | 100% (all 5 successive values recoverable) | 20% (only the latest value survives) | **MACL** |
| Consensus recovery time | ~4.3 s for a stopped node to resync to the majority | N/A — a single instance has no consensus to recover | **MACL** |

The centralised baseline mirrors MACL's data but is a plain, single, mutable store with no
replication, history table, or fingerprints — exactly the centralised design the proposal set out to
compare against. The metrics measure the consequences of those gaps.

---

## 2. Analysis — objectives achieved and narrowed

The proposal set one main objective and three specific objectives. This section maps the results
back to each.

**Specific Objective 1 — identify requirements from a review of the literature.** Achieved. The
review of permissioned-blockchain architectures, smart-contract compliance patterns, and NGO
accountability systems produced the functional requirements that shaped the design: immutable
agreements, automated threshold evaluation, and multi-party verification, delivered through an
interface usable by non-technical staff. The three-contract structure and the browser dashboard both
trace directly to those requirements.

**Specific Objective 2 — design and implement the prototype.** Achieved. The system runs on a
three-node Hyperledger Besu QBFT network with three inter-linked Solidity contracts (Agreement,
Compliance Evaluation, Verification Workflow), a Node/Express REST API using ethers.js, and a
browser dashboard with role-based controls. All three functional domains named in the proposal —
agreement encoding, threshold-based compliance evaluation, and multi-party verification — are
implemented and working, and the system additionally records programme budgets and 2-of-3 spend
approvals (an extension of the verification workflow to expenditure, with no money moving on-chain).

**Specific Objective 3 — evaluate against a centralised baseline.** Achieved. All three metrics were
measured, and each favoured MACL: tampering is detected across nodes in around 200 ms where the
centralised store cannot detect it at all; the ledger preserves a complete audit trail where the
baseline keeps only the latest value; and a diverged node rejoins and resyncs in a few seconds where
the single instance has no recovery mechanism.

**Research questions.** RQ1 (can permissioned blockchain and smart contracts address NGO
accountability?) is answered affirmatively by the working system: agreements are immutable,
compliance is evaluated identically for every party with no human discretion, and no record is
finalised without multi-party endorsement. RQ2 (what architecture is most effective?) is answered by
the three-tier design — a QBFT validator layer for distributed trust, a REST API as the single broker
that holds keys server-side, and a non-technical dashboard — together with an on-chain role registry
and 2-of-3 finality. RQ3 (how does performance compare?) is answered by the metrics in Section 1.

**Where the work was deliberately narrowed (honest limitations).** Consistent with the proposal's
proof-of-concept scope, several boundaries apply and should be stated plainly. The evaluation uses
**synthetic data on a local network**, so the findings are a proof of concept and are not
generalisable to all NGOs. The **API currently holds all three organisations' signing keys**
server-side, so while trust is genuinely distributed at the ledger layer, the Tier-2 broker is a
single point in this prototype; a production deployment would give each organisation its own API and
key. With **three validators, QBFT tolerates zero Byzantine faults** (the 2-of-3 rule still proves no
single party controls the ledger, but a production network would add validators for fault
tolerance). No **live organisational deployment** was performed, and the **DHIS2 read-only
integration** remained a documented stretch goal rather than a delivered feature. These are scope
boundaries the proposal anticipated, not failures of the objectives.

---

## 3. Discussion — why the milestones matter

Each milestone corresponds to one of the three structural problems the proposal identified in
multi-stakeholder NGO accountability.

The first problem was that **records in centralised databases can be altered retroactively without
detection**. MACL's immutable agreements and cross-node ledger answer this directly: the
tamper-detection result shows that an altered figure is caught by comparison across independent
copies, whereas the centralised baseline absorbs the change silently. The milestone matters because
it converts "trust the party that holds the record" into "any party can check the record."

The second problem was that **compliance evaluation is manual, subjective, and inconsistent**. MACL's
on-chain PASS/FAIL/FLAG evaluation removes human discretion from the judgement of whether a target
was met — the same rule runs identically for every organisation, and the result is written
immutably. This matters because it removes the space for selective enforcement and disagreement over
who is accountable for a missed target.

The third problem was that **verification depends on infrequent audits of records the audited party
controls**. MACL's 2-of-3 endorsement requirement and complete audit trail shift verification from a
periodic, after-the-fact audit to continuous, multi-party sign-off on an unalterable history. The
audit-completeness result (100% versus 20%) shows the practical difference: every reported value is
preserved and independently checkable, not overwritten.

The broader impact is twofold. For NGOs, donors, and government oversight bodies, MACL demonstrates a
path to independent verification of programme compliance without commissioning expensive external
audits, with continuous rather than annual assurance. For Rwanda's digital-transformation agenda, it
contributes a concrete, non-cryptocurrency application of blockchain in the governance sector, an
area prioritised by Vision 2050 and the ICT Sector Strategic Plan but with no existing local
reference implementation in NGO accountability.

---

## 4. Recommendations

**For the community (applying the product).**
- Deploy **one node, one API, and one signing key per participating organisation**, so that trust is
  distributed at every tier, not just at the ledger. Each organisation should hold its own key.
- Store production keys in a **secrets manager or hardware security module**, and generate fresh
  per-organisation keys — never reuse the test keys used in this prototype.
- Run a **larger validator set** (five or more) so the network tolerates a faulty or malicious node,
  rather than the three-validator proof-of-concept configuration.
- Position MACL as an **accountability layer alongside existing M&E platforms** (such as DHIS2 or
  CommCare), not a replacement — it strengthens cross-organisation verification of data those systems
  already collect.
- Before processing any real data, complete a **data-protection review** under Rwanda's Law No.
  058/2021 on the Protection of Personal Data and Privacy.

**Future work.**
- Implement the **DHIS2 read-only import** that was scoped as a stretch goal, so reported values can
  flow from existing health-sector systems.
- Add **mobile-friendly reporting** for frontline staff, and richer identity/permissioning for
  onboarding organisations at scale.
- Commission a **formal security audit** of the smart contracts before any production use.
- Run a **controlled pilot with real (anonymised) programme data** and multiple organisations to test
  the findings beyond the synthetic, single-machine setup used here.

---

*Note: the analysis, discussion, and recommendations above are to be reviewed and refined together
with the project supervisor, as required by the assignment.*
