# MACL — Multi-Stakeholder Accountability and Compliance Ledger

MACL is a permissioned-blockchain system that lets an NGO, a government M&E unit, and a donor share **one** tamper-resistant record of a development programme. Agreements and their targets live on-chain, reported results are evaluated automatically, programme spend is requested and approved against a budget, and a result is final only after a 2-of-3 multi-party sign-off — so no single party controls the record. (BSc Software Engineering capstone — final system.)

## Problem

In multi-stakeholder NGO programmes the master record usually sits in one organisation's database. That party can alter history before an audit, compliance is judged manually and inconsistently, and verification depends on infrequent audits of records the audited party itself controls. No other party can independently trust the records between audits.

## Mission

Replace single-custodian trust with a shared, rule-based ledger: encode commitments as immutable agreements, evaluate compliance automatically and identically for everyone, require multi-party endorsement before any result is finalised, and make every node's copy of the ledger independently checkable.

## Application area

NGO programme accountability in Rwanda. The three stakeholders are the implementing **NGO**, a **government M&E** unit, and a **donor**. Scope is programme-level records — agreements, targets, reported results, budgets, and spend approvals. It does not move money or hold personal data, and runs on synthetic programme data.

## Features

- **Immutable agreements** — a donor encodes an agreement + measurable targets and locks it; terms can't change afterward.
- **Automatic compliance** — a reported value is evaluated on-chain against the target → **PASS / FAIL / FLAG**, with no human discretion.
- **Budget & spend approval** — each agreement carries a budget; the NGO raises a spend request (amount, purpose, supporting-document fingerprint), and it is APPROVED only at **2 of 3** endorsements. The request's own submitter cannot approve it. Money never moves on-chain — only figures and document hashes are recorded.
- **Multi-party verification** — a record finalises only after **2 of 3** organisations endorse it; any party can instead **decline** (dispute) it. The finalised record stores the ledger block hash.
- **Verification window** — a record that doesn't reach 2-of-3 within a configurable window (default 30 days, measured from submission) can no longer be finalised and is marked **UNVERIFIED** — a terminal state — instead of sitting pending forever (matching the proposal's flowchart). The window is owner-settable, so a short value demonstrates expiry live.
- **Evidence storage with on-chain fingerprints** — supporting documents, settlement receipts, and report evidence are uploaded to a Neon (Postgres) store through the API and keyed by their SHA-256, which is computed **server-side**; only that hash goes on-chain. Every stored document has a one-click **View / Verify** (on Reports, Budget & Spend, and Audit Trail): the server fetches the stored file, re-hashes it, and reports *verified / not-verified* against the on-chain hash — a match means "unchanged since recorded" (not proof the document was genuine to begin with).
- **Cross-node integrity** — the dashboard queries all three Besu nodes (via the API) and shows whether they hold an identical copy of each record ("verified across 3 nodes" / "2 of 3 nodes agree"), making tamper-resistance visible.
- **Per-org login** — each organisation (Donor-Admin / NGO / Government-Audit) signs in separately; the API issues a JWT session and signs transactions with that org's server-side key, so a session can only ever act as the org it logged in as (no in-browser key, no role switcher).
- **"Needs your action" + plain language** — after login the Overview shows exactly what is waiting on the signed-in org (reports/spend awaiting its endorsement, agreements it can finalise), each linking straight to the page to act. Blockchain terms (endorse, finalise, block hash, PASS/FAIL/FLAG, 2-of-3) carry hover tooltips that explain them in plain language, so non-technical staff aren't blocked by jargon.
- **Audit trail** — searchable record history with endorsements and declines, exportable to CSV / PDF.

## Architecture

Three tiers — browser → REST API → chain:

- **Contracts (Tier-3, the ledger)** — three wired Solidity contracts hold all state and rules:
  - `AgreementContract` — agreements + targets + budget + the on-chain org registry; locks on finalise.
  - `ComplianceEvaluationContract` — records reported values, auto-evaluates PASS/FAIL/FLAG; holds spend requests checked against the budget.
  - `VerificationWorkflowContract` — endorsements/declines; finalises records and approves spend at 2-of-3 and stamps the block hash; enforces a configurable verification window after which an un-finalised record is marked UNVERIFIED.
  - Deploy order: Agreement → Compliance(agreementAddr) → Verification(complianceAddr) → setVerificationContract → setComplianceContract.
- **REST API (Tier-2, `api/`)** — a Node/Express + ethers v6 service that is the **single broker** between the dashboard and the chain. It authenticates each org (JWT login) and signs with that org's **server-side** key, exposes one endpoint per contract action plus the reads, proxies the cross-node integrity check so the validators' JSON-RPC is never exposed to the browser, and **stores the actual evidence files** (spend supporting documents, receipts, report evidence) in a Neon (managed Postgres) store keyed by their SHA-256 — computing the hash server-side. Only the hash ever goes on-chain.
- **Dashboard (Tier-1, presentation)** — plain HTML/CSS/JS that calls the REST API over HTTP. Users sign in per org (login screen → JWT held in the browser); the browser holds **no private keys** and never talks to the chain directly.

The system runs on a 3-node **Hyperledger Besu (QBFT)** permissioned network. **Hardhat is used only as a toolchain** — to compile the contracts, run the unit tests in-process, and deploy to Besu. It is not the runtime chain.

## Tools

Solidity 0.8.24 · Hyperledger Besu (QBFT) + Docker (the chain) · Node/Express REST API with JWT auth · ethers.js v6 · Neon (managed PostgreSQL) for document storage · plain HTML/CSS/JS · Hardhat 2 (compile/test/deploy toolchain) · Node.js 20

## Run MACL on the Besu network

Full, ordered steps are in **`RUN-BESU.md`**. In brief:

**1 — Start the 3-node Besu QBFT network**

```bash
cd blockchain && ./setup-network.sh && docker compose up   # validators on 8545 / 8546 / 8547
```

**2 — Deploy + wire the contracts onto Besu** (new terminal)

```bash
cd contracts && npm install && cp .env.example .env   # first time: set DEPLOYER_PRIVATE_KEY + BESU_RPC_URL
npm run deploy:besu
```

Addresses are pre-filled in `api/.env.example` (the API's config); only paste new ones if you deploy onto a chain whose deployer nonce isn't 0.

**3 — Start the REST API** (new terminal)

```bash
cd api && npm install && cp .env.example .env   # signer keys, JWT_SECRET + login hashes (server-side, gitignored)
# Set DATABASE_URL in api/.env to your Neon (or local) Postgres, then create the table:
npm run migrate                                  # creates the documents table (skip if not using file storage)
npm start                                        # listens on http://127.0.0.1:3001
```

Set the auth values in `api/.env` before starting (hardened in S1):

- `JWT_SECRET` is **required and fail-closed** — the API refuses to boot if it is missing or shorter than 32 characters. Generate one with `openssl rand -hex 32`.
- Login passwords are stored as **bcrypt hashes**, never plaintext. For each org run `node scripts/hash-password.js '<password>'` and paste the printed hash into `DONOR_PW_HASH` / `NGO_PW_HASH` / `AUDIT_PW_HASH`. A role with no hash simply cannot log in.

**4 — Serve the dashboard** (new terminal, from the repo root)

```bash
npx http-server . -p 8080 -c-1
```

Open **<http://localhost:8080/dashboard/>** → you're sent to the **sign-in** page. Log in as an org (e.g. Donor-Admin, using the password whose hash you set in step 3). The connection light should read `connected · block #N`, rising every ~2s as QBFT produces blocks. The dashboard talks only to the API (port 3001); the API talks to the chain. To act as another org, **Sign out** and sign in as that org. (Needs internet for the Tailwind/font CDNs; all chain data stays local.)

**Contract unit tests**, anytime (Hardhat, in-process):

```bash
cd contracts && npm test
```

**API tests** (routing/validation, no chain needed):

```bash
cd api && npm test
```

## Interacting with the contracts

- **Via the dashboard (normal path):** sign in as an org and act (sign out + sign in as another to switch) — Donor-Admin creates, budgets, and finalises agreements; NGO submits reports and raises spend requests; all three endorse or decline. Typical flow: create + lock a target (`beneficiaries_reached ≥ 1000`) → sign in as NGO and submit a value (≥ on time = PASS, < threshold = FAIL, ≥ but late = FLAG) → endorse from two different orgs → the record finalises with a block hash, or decline to dispute it. For spend: set a budget → NGO raises a request → the two other orgs endorse to reach 2-of-3 → remaining budget drops.
- **Via the API (Tier-2):** every dashboard action maps to a REST endpoint (e.g. `POST /api/agreements`, `POST /api/reports`, `POST /api/spend/:id/endorse`, `GET /api/records`, `GET /api/nodes`). The browser sends a role name; the API signs with that role's server-side key.
- **Directly (optional, admin):** `cd contracts && npx hardhat console --network besu`, then use ethers to call the contracts at the deployed addresses.

## Security & secrets

The repo is built so that **no real secret is ever committed**. Practical rules:

- **`.env` files stay local.** Every `.env` is git-ignored (`**/.env`). **Never** include any `.env` in `submission.zip` or any shared archive — it holds the live `DATABASE_URL`, `JWT_SECRET`, and signer keys. If a copy of a real credential ever leaves this machine, **rotate it** (e.g. reset the Neon database password in the Neon console).
- **Signer/deployer keys are PUBLIC TEST keys (F-11).** The keys in `api/.env.example` / `contracts/.env.example` are the well-known Hardhat/Besu test keys — no real funds, safe **only** for this isolated permissioned network. Any real deployment must generate **fresh per-org keys** held in a secrets manager / HSM, never in a file. The old deployer key also exists in this repo's **git history**; purge it with `git filter-repo` or BFG before any public release.
- **Auth is hardened.** `JWT_SECRET` is required and fail-closed (≥ 32 chars or the API won't start); login passwords are bcrypt hashes (`*_PW_HASH`), never plaintext.
- **Database TLS is verified (F-12).** A remote Postgres is always connected with the certificate verified; pin the provider's CA with `PG_CA_CERT` for the strongest setting.
- **Secret-leak guard.** Run `cd api && npm run check:secrets` to scan the tracked working tree **and** git history for real secret patterns (Neon `npg_` passwords, non-test private keys, real `JWT_SECRET` values). It prints only the file/commit and pattern, never the secret, and exits non-zero if anything is found. The public test keys are allow-listed, so a clean repo passes.

## Conclusion

MACL shows that distributed, rule-based verification can replace single-custodian trust in NGO programme accountability: the contracts make agreements immutable, evaluate compliance identically for every party, require multi-party agreement to finalise and to approve spend, and let each organisation independently check that every node holds the same record — all driven from a dashboard usable by non-technical staff. The remaining work for the evaluation chapter is the RQ3 comparison against a centralised PostgreSQL baseline (tamper-detection latency, consensus recovery time, audit-trail completeness).
