# MACL — Testing Evidence

Screenshots and results demonstrating the system under different testing strategies and data values.
Each item maps to the assignment's testing requirements.

## 1. Automated tests (unit-testing strategy)
- [ ] `01-contract-tests-pass.png` — Hardhat contract test suite passing (`cd contracts && npm test`)
- [ ] `02-api-tests-pass.png` — API test suite passing (`cd api && npm test`)

## 2. Functional tests with different data values
- [ ] `03-report-PASS.png` — reported value ≥ threshold, on time → PASS
- [ ] `04-report-FAIL.png` — reported value below threshold → FAIL
- [ ] `05-report-FLAG.png` — value ≥ threshold but after the deadline → FLAG
- [ ] `06-record-UNVERIFIED.png` — record left past its verification window → UNVERIFIED

## 3. Edge-case / negative tests
- [ ] `07-overbudget-rejected.png` — spend request above remaining budget is refused
- [ ] `08-self-approval-blocked.png` — NGO cannot approve its own spend request
- [ ] `09-wrong-role-blocked.png` — a role attempting an action it isn't allowed to do
- [ ] `10-record-declined.png` — a record disputed (declined) instead of endorsed

## 4. Tamper-resistance & cross-node integrity
- [ ] `11-nodes-in-sync.png` — Network Integrity panel: 3 nodes in sync
- [ ] `12-node-down-flagged.png` — one node stopped → flagged red / "2 of 3 nodes agree"
- [ ] `13-node-resynced.png` — node restarted → back to "verified across 3 nodes"

## 5. Performance across environments (RQ3)
- [ ] `14-evaluation-results.png` — the RQ3 metrics table (`evaluation/results/metrics.md`)
- [ ] `15-evaluation-second-env.png` — same evaluation run on a second machine/spec (do when hosted)

## 6. Multi-party endorsement (core flow)
- [ ] `16-2of3-finalised.png` — a record finalised at 2-of-3 with its block hash
