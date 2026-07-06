# MACL — Multi-Stakeholder Accountability and Compliance Ledger

MACL is a permissioned-blockchain system that lets an NGO, a government M&E unit, and a donor share
one tamper-resistant record of a development programme. Agreements and their targets live on-chain,
reported results are evaluated automatically, programme spend is requested and approved against a
budget, and a result is final only after a 2-of-3 multi-party sign-off, so no single party controls
the record. (BSc Software Engineering capstone.)

## Quick links

- Demo video: <https://drive.google.com/file/d/1KSa2JvIxu-KOBbV80jwDLvXvl9kl6w-r/view?usp=sharing>
- Live demo: <http://145.241.184.66/> — the full system hosted on a cloud VM (3-node Besu chain, REST API, dashboard). Login password for each role (donor / ngo / audit) is `macl1234`.
- Run it locally: [`RUN-BESU.md`](RUN-BESU.md)
- Deploy it to a server: [`DEPLOYMENT.md`](DEPLOYMENT.md)
- Results, analysis and discussion: [`RESULTS.md`](RESULTS.md)
- Testing evidence: [`testing-evidence/`](testing-evidence/)

## Problem

In multi-stakeholder NGO programmes the master record usually sits in one organisation's database.
That party can alter history before an audit, compliance is judged manually and inconsistently, and
verification depends on infrequent audits of records the audited party itself controls. No other
party can independently trust the records between audits.

## Mission

Replace single-custodian trust with a shared, rule-based ledger: encode commitments as immutable
agreements, evaluate compliance automatically and identically for everyone, require multi-party
endorsement before any result is finalised, and make every node's copy of the ledger independently
checkable.

## Application area

NGO programme accountability in Rwanda. The three stakeholders are the implementing NGO, a government
M&E unit, and a donor. Scope is programme-level records: agreements, targets, reported results,
budgets, and spend approvals. It does not move money or hold personal data, and runs on synthetic
data.

## Features

- Immutable agreements. A donor encodes an agreement plus measurable targets and locks it; terms
  can't change afterward.
- Automatic compliance. A reported value is evaluated on-chain against the target as PASS, FAIL, or
  FLAG, with no human discretion.
- Budget and spend approval. Each agreement carries a budget; the NGO raises a spend request (amount,
  purpose, supporting-document fingerprint), which is approved only at 2 of 3 endorsements. The
  request's own submitter cannot approve it. Money never moves on-chain; only figures and document
  hashes are recorded.
- Multi-party verification. A record finalises only after 2 of 3 organisations endorse it; any party
  can instead decline (dispute) it. The finalised record stores the ledger block hash.
- Verification window. A record that doesn't reach 2-of-3 within a configurable window (default 30
  days) can no longer be finalised and is marked UNVERIFIED, a terminal state, instead of sitting
  pending forever. The window is owner-settable, so a short value can demonstrate expiry live.
- Evidence storage with on-chain fingerprints. Supporting documents, receipts, and report evidence
  are uploaded to a Neon (Postgres) store through the API and keyed by their SHA-256, computed
  server-side; only that hash goes on-chain. A one-click View / Verify re-hashes the stored file and
  reports whether it is unchanged since it was recorded.
- Cross-node integrity. The dashboard queries all three Besu nodes (via the API) and shows whether
  they hold an identical copy of each record ("verified across 3 nodes" / "2 of 3 nodes agree").
- Per-org login. Each organisation signs in separately; the API issues a JWT session and signs
  transactions with that org's server-side key, so a session can only act as the org it logged in as.
  The browser holds no keys.
- "Needs your action" and plain language. After login the Overview shows what is waiting on the
  signed-in org, each item linking to the page to act. Blockchain terms carry hover tooltips in plain
  language so non-technical staff aren't blocked by jargon.
- Audit trail. Searchable record history with endorsements and declines, exportable to CSV or PDF.

## Architecture

Three tiers: browser → REST API → chain.

- Contracts (Tier-3, the ledger). Three wired Solidity contracts hold all state and rules:
  - `AgreementContract`: agreements, targets, budget, and the on-chain org registry; locks on
    finalise.
  - `ComplianceEvaluationContract`: records reported values, auto-evaluates PASS/FAIL/FLAG; holds
    spend requests checked against the budget.
  - `VerificationWorkflowContract`: endorsements and declines; finalises records and approves spend
    at 2-of-3, stamps the block hash, and enforces the verification window.
  - Deploy order: Agreement → Compliance(agreementAddr) → Verification(complianceAddr) →
    setVerificationContract → setComplianceContract.
- REST API (Tier-2, `api/`). A Node/Express service using ethers v6, the single broker between the
  dashboard and the chain. It authenticates each org (JWT login), signs with that org's server-side
  key, exposes one endpoint per contract action plus the reads, proxies the cross-node integrity
  check so the validators' JSON-RPC is never exposed to the browser, and stores the evidence files in
  a Neon (Postgres) store keyed by their SHA-256. Only the hash goes on-chain.
- Dashboard (Tier-1, presentation). Plain HTML/CSS/JS that calls the REST API over HTTP. Users sign
  in per org; the browser holds no private keys and never talks to the chain directly.

The system runs on a 3-node Hyperledger Besu (QBFT) permissioned network. Hardhat is used only as a
toolchain (to compile the contracts, run the unit tests in-process, and deploy to Besu), not as the
runtime chain.

## Tools

Solidity 0.8.24, Hyperledger Besu (QBFT) with Docker, Node/Express REST API with JWT auth, ethers.js
v6, Neon (managed PostgreSQL) for document storage, plain HTML/CSS/JS, Hardhat 2 (compile/test/deploy
toolchain), Node.js 20.

## Run MACL on the Besu network

Full, ordered steps are in [`RUN-BESU.md`](RUN-BESU.md). In brief:

1. Start the 3-node Besu QBFT network:

   ```bash
   cd blockchain && ./setup-network.sh && docker compose up   # validators on 8545 / 8546 / 8547
   ```

2. Deploy and wire the contracts (new terminal):

   ```bash
   cd contracts && npm install && cp .env.example .env
   npm run deploy:besu
   ```

   Addresses are pre-filled in `api/.env.example`; only paste new ones if the deployer nonce isn't 0.

3. Start the REST API (new terminal):

   ```bash
   cd api && npm install && cp .env.example .env
   # set JWT_SECRET and login hashes; set DATABASE_URL + run `npm run migrate` if using file storage
   npm start                                        # listens on http://127.0.0.1:3001
   ```

   `JWT_SECRET` is required (32+ chars; the API won't boot without it). Login passwords are stored as
   bcrypt hashes; generate each with `node scripts/hash-password.js '<password>'`.

4. Serve the dashboard (new terminal, from the repo root):

   ```bash
   npx http-server . -p 8080 -c-1
   ```

   Open <http://localhost:8080/dashboard/>, sign in as an org, and the connection light reads
   `connected · block #N`, rising every ~2s. To act as another org, sign out and sign in as that org.

Run the tests anytime: `cd contracts && npm test` and `cd api && npm test`.

## Interacting with the contracts

- Via the dashboard (normal path): sign in as an org and act. Donor creates, budgets, and finalises
  agreements; NGO submits reports and raises spend requests; all three endorse or decline. Typical
  flow: create and lock a target (e.g. `beneficiaries_reached ≥ 1000`), submit a value as NGO (≥ and
  on time = PASS, below = FAIL, ≥ but late = FLAG), endorse from two different orgs to finalise it
  with a block hash, or decline to dispute it. For spend: set a budget, the NGO raises a request, the
  two other orgs endorse to reach 2-of-3, and remaining budget drops.
- Via the API: every dashboard action maps to a REST endpoint (e.g. `POST /api/agreements`,
  `POST /api/reports`, `POST /api/spend/:id/endorse`, `GET /api/records`, `GET /api/nodes`).
- Directly (optional): `cd contracts && npx hardhat console --network besu`, then use ethers to call
  the contracts at the deployed addresses.

## Security and secrets

- `.env` files stay local. Every `.env` is git-ignored. They hold the `DATABASE_URL`, `JWT_SECRET`,
  and signer keys, so never include one in a shared archive. If a real credential leaves the machine,
  rotate it.
- The signer/deployer keys in the `*.env.example` files are the well-known public Hardhat/Besu test
  keys, safe only for this isolated network. A real deployment should use fresh per-org keys held in
  a secrets manager, not a file.
- Auth is hardened: `JWT_SECRET` is required and fail-closed, and login passwords are bcrypt hashes.
- `cd api && npm run check:secrets` scans the tracked files and git history for real secret patterns;
  the public test keys are allow-listed, so a clean repo passes.

## Testing and evaluation

MACL is exercised under several testing strategies:

- Automated unit tests: smart-contract tests with Hardhat (`cd contracts && npm test`) and API
  routing/validation/auth tests with the Node test runner (`cd api && npm test`).
- Functional tests with different data values: reports evaluate on-chain to PASS, FAIL, or FLAG, and
  records that miss the verification window become UNVERIFIED.
- Edge-case tests: over-budget spend is refused, an org cannot approve its own spend request, actions
  are blocked for roles that may not perform them, and any party can dispute a record.
- Tamper-resistance and consensus recovery: taking a validator offline is flagged across nodes, the
  2-of-3 majority keeps the canonical chain, and the node resyncs on rejoin
  (`blockchain/tamper-demo.sh`).
- Comparative performance (RQ3): the `evaluation/` harness measures tamper-detection latency,
  audit-trail completeness, and consensus-recovery time against a centralised PostgreSQL baseline.

Screenshots are in [`testing-evidence/`](testing-evidence/), and the full results, analysis, and
discussion are in [`RESULTS.md`](RESULTS.md).

## Conclusion

MACL shows that distributed, rule-based verification can replace single-custodian trust in NGO
programme accountability. The contracts make agreements immutable, evaluate compliance identically
for every party, require multi-party agreement to finalise and to approve spend, and let each
organisation check that every node holds the same record, all from a dashboard usable by
non-technical staff. The RQ3 comparison against a centralised PostgreSQL baseline (see `evaluation/`)
found that MACL detects a tampered figure across nodes in milliseconds where the centralised store
does not detect it at all, keeps a complete audit trail where the baseline overwrites in place, and
recovers a diverged node to the majority chain automatically. Full results are in
`evaluation/results/metrics.md`.
