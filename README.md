# MACL — Multi-Stakeholder Accountability and Compliance Ledger

A permissioned-blockchain accountability layer for NGO programme compliance in Rwanda. MACL lets an implementing NGO, a government M&E unit, and a donor share one tamper-resistant record of programme agreements and results, where compliance is evaluated automatically by smart contracts and no single party can finalise a record alone.

**Capstone:** BSc Software Engineering, African Leadership University · **Author:** Aimee Gloire Imaragahinda · **Supervisor:** Dr Aaron A. Izang
**Assignment:** Initial Software Demo (MVP)

> **GitHub repo:** _add your repository URL here after pushing_ → `https://github.com/<your-username>/macl`

---

## What this MVP demonstrates

1. **Distributed custody** — three Hyperledger Besu validators (QBFT consensus) hold identical copies of the ledger. Block finality needs a 2-of-3 supermajority, so no single node can rewrite history.
2. **Automated compliance** — a reported value is evaluated on-chain against the agreed target → `PASS` / `FAIL` / `FLAG`, with no human discretion.
3. **Multi-party verification** — a result is only finalised after two of the three organisations endorse it.

---

## Requirements → features (traceability)

The three structural problems from the proposal map directly to implemented features:

| Problem (proposal §1.2) | MVP feature | Where |
|---|---|---|
| Centralised records can be altered without detection | 3-node QBFT ledger; identical copies; 2-of-3 finality | `blockchain/` |
| Compliance evaluated manually & inconsistently | On-chain threshold evaluation → PASS/FAIL/FLAG | `ComplianceEvaluationContract.sol` |
| Verification depends on infrequent audits of self-held records | Multi-party endorsement before finalisation; queryable audit trail | `VerificationWorkflowContract.sol` |

**Functional requirements covered:** encode agreement + targets · submit a report · auto-evaluate against threshold · collect endorsements · finalise at 2-of-3 · query ledger / audit trail.
**Non-functional:** tamper-resistance, multi-party trust, non-technical browser UI, open-source toolchain, runs on a single laptop.

## Tools & why they were chosen

| Layer | Tool | Why |
|---|---|---|
| Blockchain | **Hyperledger Besu** (QBFT) | Enterprise permissioned chain; QBFT is the Besu-recommended BFT consensus; identity-based, no tokens/gas economics |
| Contracts | **Solidity 0.8.x** | EVM standard; prior coursework experience carries over |
| Contract tooling | **Hardhat** | Fast local EVM for the dev loop; compile, test, deploy to Besu |
| Contract↔chain | **ethers.js 6** | Standard JSON-RPC client used by both deploy scripts and the API |
| API | **Node.js 20 + Express** | Lightweight REST layer between the browser and the chain |
| Frontend | **React 18** | Component-based role dashboards for non-technical users |
| Orchestration | **Docker Compose** | Runs the 3 validators as isolated containers on one machine |
| Baseline | **PostgreSQL 16** | Centralised comparison for the tamper-resistance evaluation |
| Analysis | **Python 3.12** (pandas, matplotlib) | Charts the evaluation metrics |

Everything is open-source; the project runs entirely on local hardware (Apple M4). See `MACL-Proposal-Reference.md` for full scope.

---

## Repository structure

```
macl/
├── blockchain/      # 3-node Besu QBFT network (config, compose, scripts)
├── contracts/       # Hardhat project: 3 Solidity contracts + tests + deploy
├── api/             # Express + ethers.js REST API            (next phase)
├── dashboard/       # React app, 3 role views                 (next phase)
├── baseline/        # PostgreSQL schema + tamper scripts       (eval phase)
└── docs/            # architecture, ERD, mockups, screenshots
```

The three smart contracts:

- **AgreementContract** — lifecycle of programme agreements + measurable targets.
- **ComplianceEvaluationContract** — records reported values and auto-evaluates them (PASS/FAIL/FLAG).
- **VerificationWorkflowContract** — collects endorsements; finalises at the 2-of-3 threshold and stamps the ledger block hash.

---

## Set up the environment

**Prerequisites:** Node.js 20 LTS, Docker Desktop, Git. (Besu itself runs via Docker — no separate install needed.)

### 1. Contracts (Hardhat dev loop)

```bash
cd contracts
npm install
cp .env.example .env
npm test          # runs the full MACL contract test suite on Hardhat's in-memory EVM
```

### 2. Blockchain (3-node Besu QBFT network)

```bash
cd ../blockchain
./setup-network.sh        # generates genesis + 3 validator keys, writes .env
docker compose up         # starts Node-1 (8545), Node-2 (8546), Node-3 (8547)
```

In another terminal, confirm consensus and that all three nodes agree:

```bash
./check-network.sh        # prints the 3 validators + matching block heights
```

### 3. Deploy the contracts to the live network

```bash
cd ../contracts
npm run deploy:besu       # deploys all 3 contracts to the Besu network and wires them
```

Save the printed contract addresses — the API/dashboard read them from `.env`.

> **Next phases (`api/`, `dashboard/`)** are built in the following work session; see `MACL-Hands-On-Setup-Walkthrough.md`.

---

## Designs

See `docs/`:

- `architecture.md` / architecture diagram — the 3-tier system (blockchain / API / presentation).
- ERD — the five entities (Organisation, ProgrammeAgreement, ProgrammeTarget, ComplianceRecord, Endorsement).
- Dashboard mockups (Figma) and app screenshots — _added once the dashboard is built._

---

## Security measures

- **Consensus integrity** — QBFT BFT consensus; 2-of-3 supermajority required to finalise a block, so a single compromised node cannot rewrite the ledger. (With 3 validators the network tolerates 0 Byzantine faults by the `3f+1` rule; the proof-of-concept demonstrates distributed custody, and ≥4 validators is the production path.)
- **Permissioned access** — identity-based validator set fixed in the genesis file; membership changes require on-chain QBFT voting, not config edits.
- **Authorisation in contracts** — only an agreement's creator can edit/finalise it; only the wired verification contract can mark a record finalised; an organisation cannot endorse the same record twice.
- **Tamper evidence** — every finalised record stores the ledger block hash, linking application data to immutable chain state.
- **API (next phase)** — JWT sessions; the API signs transactions per identified user; all persistent state lives on-chain (stateless API).

---

## Deployment plan

- **Now (MVP / demo):** everything local on the Apple M4 — 3 Besu validators as Docker containers on a private bridge network, Hardhat for the contract dev loop, synthetic data only.
- **Defence (optional):** one cloud-hosted demo node + a demo domain (~51,000 RWF, proposal §1.7) only if a public URL is needed; the same Docker Compose file deploys unchanged.
- **Production path (out of scope):** ≥4 validators across real organisations, a full data-protection review under Rwanda Law No. 058/2021, and read-only DHIS2 import.

---

## Status

- [x] Three smart contracts written and compiling (solc 0.8.24, 0 warnings)
- [x] Hardhat test suite (agreement lifecycle, PASS/FAIL/FLAG evaluation, 2-of-3 finalisation)
- [x] 3-node Besu QBFT network config + Docker Compose + helper scripts
- [ ] REST API (Express + ethers.js)
- [ ] React dashboard (NGO / Audit / Donor-Admin views) + ledger visualisation
- [ ] PostgreSQL baseline + tamper-resistance evaluation
