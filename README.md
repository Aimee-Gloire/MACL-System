# MACL — Multi-Stakeholder Accountability and Compliance Ledger

MACL is a permissioned-blockchain system that lets an NGO, a government M&E unit, and a donor share **one** tamper-resistant record of a development programme. Agreements and their targets live on-chain, reported results are evaluated automatically, and a result is final only after a 2-of-3 multi-party sign-off — so no single party controls the record. (BSc Software Engineering capstone — Initial Software Demo / MVP.)

## Problem

In multi-stakeholder NGO programmes the master record usually sits in one organisation's database. That party can alter history before an audit, compliance is judged manually and inconsistently, and verification depends on infrequent audits of records the audited party itself controls. No other party can independently trust the records between audits.

## Mission

Replace single-custodian trust with a shared, rule-based ledger: encode commitments as immutable agreements, evaluate compliance automatically and identically for everyone, and require multi-party endorsement before any result is finalised.

## Application area

NGO programme accountability in Rwanda. The three stakeholders are the implementing **NGO**, a **government M&E** unit, and a **donor**. Scope is programme-level records — agreements, targets, reported results. It does not handle payments or personal data, and runs on synthetic data for the demo.

## Features

- **Immutable agreements** — a donor encodes an agreement + measurable targets and locks it; terms can't change afterward.
- **Automatic compliance** — a reported value is evaluated on-chain against the target → **PASS / FAIL / FLAG**, with no human discretion.
- **Multi-party verification** — a record finalises only after **2 of 3** organisations endorse it; any party can instead **decline** (dispute) a record. The finalised record stores the ledger block hash.
- **Role dashboard** — a browser UI with a role switcher (Donor-Admin / NGO / Government-Audit); each role signs with its own account and only operates the controls it is allowed to.
- **Audit trail** — searchable record history with endorsements and declines, exportable to CSV / PDF.

## Architecture

Two tiers, with no API in between:

- **Contracts (the backend)** — three wired Solidity contracts hold all state and rules:
  - `AgreementContract` — agreements + targets; locks on finalise.
  - `ComplianceEvaluationContract` — records reported values, auto-evaluates PASS/FAIL/FLAG.
  - `VerificationWorkflowContract` — endorsements/declines; finalises at 2-of-3 and stamps the block hash.
  - Deploy order: Agreement → Compliance(agreementAddr) → Verification(complianceAddr) → setVerificationContract.
- **Dashboard (presentation)** — plain HTML/CSS/JS + ethers.js in the browser, talking straight to the deployed contracts.

Development and the demo run on a local **Hardhat** node; the production target is a 3-node **Hyperledger Besu (QBFT)** permissioned network running the same contracts.

## Tools

Solidity 0.8.24 · Hardhat 2 · ethers.js v6 · Node.js 20 · plain HTML/CSS/JS · Hyperledger Besu + Docker (production target)·

## Run the demo

Three terminals, from the repo root.

**1 — Start the chain**

```bash
cd contracts && npm install && npx hardhat node      # JSON-RPC at http://127.0.0.1:8545
```

**2 — Deploy + wire the contracts** (new terminal)

```bash
cd contracts && npm run deploy:local
```

Addresses are deterministic on a fresh node and already match `dashboard/config.js`. Restart the node → redeploy.

**3 — Serve the dashboard** (new terminal)

```bash
npx http-server . -p 8080 -c-1
```

Open **<http://localhost:8080/dashboard/>** — the connection light should read `connected · block #N`. (Needs internet for the Tailwind/font CDNs; all chain data stays local.)

**Tests**, anytime:

```bash
cd contracts && npm test       # 10 passing
```

**Optional — 3-node Besu QBFT network**

```bash
cd blockchain && ./setup-network.sh && docker compose up
cd ../contracts && npm run deploy:besu
```

## Interacting with the contracts

- **Via the dashboard (normal path):** pick a role (top-right) and act — Donor-Admin creates and finalises agreements, NGO submits reports, all three endorse or decline. Typical flow: create + lock a target (`beneficiaries_reached ≥ 1000`) → as NGO submit a value (≥ on time = PASS, < threshold = FAIL, ≥ but late = FLAG) → endorse from two roles → the record finalises with a block hash, or decline to dispute it.
- **Directly (optional):** `cd contracts && npx hardhat console --network localhost`, then use ethers to call the contracts at the addresses above.

## Conclusion

MACL shows that distributed, rule-based verification can replace single-custodian trust in NGO programme accountability: the contracts make agreements immutable, evaluate compliance identically for every party, and require multi-party agreement to finalise — all driven from a dashboard usable by non-technical staff. Out of scope for this MVP and left as next steps: the live 3-node Besu deployment, an optional REST API, and a tamper-resistance evaluation against a centralised baseline.
