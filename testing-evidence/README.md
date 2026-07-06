# MACL — Testing Evidence

## 1. Automated tests (unit-testing strategy)
- [ ] `01-contract-tests-pass.png` — Hardhat contract test suite passing (`cd contracts && npm test`)
- [ ] `02-api-tests-pass.png` — API test suite passing (`cd api && npm test`)

## 2. Functional tests with different data values
- [ ] `03-report-PASS.png` — reported value ≥ threshold, on time → PASS
- [ ] `04-report-FAIL.png` — reported value below threshold → FAIL
- [ ] `05-report-FLAG.png` — value ≥ threshold but after the deadline → FLAG
- [ ] `06-record-UNVERIFIED.png` — record left past its verification window → UNVERIFIED
