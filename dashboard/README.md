# MACL Dashboard

A plain HTML/CSS/JS dashboard that talks **directly** to the three MACL smart
contracts via [ethers.js](https://docs.ethers.org) in the browser. There is **no
API and no React** — the deployed contracts *are* the backend.

The UI is the Stitch-generated "MACL Institutional Ledger" design (Rwanda-green
institutional theme), with its mock content replaced by live on-chain data.

## Pages

| Page | Acts as | What it does |
|------|---------|--------------|
| **Overview** (`index.html`) | — | Live metrics (agreements, pending endorsements, compliance rate), 3-node status, recent activity, CSV export. |
| **Agreements** (`agreements.html`) | Donor-Admin | Create an agreement + measurable targets, then **Finalise & Lock**. |
| **Reports** (`reports.html`) | NGO | Report a value against a finalised target; the ledger auto-evaluates **PASS/FAIL/FLAG**. |
| **Audit Trail** (`audit.html`) | Audit | **Endorse** or **Decline** records; finalises at the **2-of-3** threshold (a 3rd endorsement is still recorded). Export CSV / PDF. |

The role switcher (top-right of every page) chooses **which Hardhat account signs**
each transaction, and persists across pages. Each role is a distinct, well-known
**Hardhat test account** — which is what makes the 2-of-3 endorsement meaningful
(two different addresses must endorse a record).

## Run it

You need three terminals. Run the static server **from the repo root** (`macl/`)
so the browser can fetch the contract ABIs from `contracts/artifacts/…`.

**1 — Start the local chain** (terminal 1):
```bash
cd contracts
npx hardhat node          # JSON-RPC at http://127.0.0.1:8545
```

**2 — Deploy the contracts** (terminal 2):
```bash
cd contracts
npm run deploy:local
```
Confirm the three deterministic addresses match `dashboard/config.js` (they will,
on a *fresh* node). If you restart the node, redeploy.

**3 — Serve the dashboard from the repo root** (terminal 3):
```bash
# from macl/
npx http-server . -p 8080 -c-1
```

**4 — Open it:**
```
http://localhost:8080/dashboard/
```
The connection light (bottom of the sidebar) should read `connected · block #N`.

## Demo walk-through

1. **Agreements** (acting as Donor-Admin) → *Create New Agreement* → add a target
   (e.g. `beneficiaries_reached ≥ 1000 people`) → **Finalise & Lock**.
2. Switch role to **NGO** → **Reports** → pick that agreement + target → submit a value:
   - `≥ threshold` before the deadline → **PASS**
   - `< threshold` → **FAIL**
   - `≥ threshold` but after the deadline → **FLAG**
3. **Audit Trail** → **Endorse** (or **Decline**) the record. Switch role to a second
   stakeholder and **Endorse** again → count hits **2/3** → the record is **Finalised**
   with a block hash. A third stakeholder can still **Endorse** (recorded as 3/3 for the
   audit trail); a **Decline** is recorded as dissent and shows the record as *Disputed*.
   Export the trail to **CSV** or **PDF**.
4. **Overview** reflects the new live counts.

## Notes on alignment (what was cut from the Stitch mock)

The Stitch screens shipped generic-enterprise content that didn't match MACL. Removed:
**"Total Value Locked $4.2M"** and the **USD** target unit (MACL handles no money/tokens);
**"MULTI-SIG PBFT"** → it's **QBFT**; **"12 nodes / +9 validators"** → MACL is a **3-node**
network on one dev node; **"endorsed by 12"** → max **3**; the **GENERATE HASH** button,
auth chrome (avatar/notifications/search/sign-out), and all fabricated counts/timestamps.
**Export PDF/CSV** was kept (it matches the proposal's "export the audit trail for offline
reporting" goal) and wired to live data.

## Architecture

- **Addresses + keys** live only in `config.js`. To point at Besu later, change
  `RPC_URL` and `ADDRESSES` there — nothing else.
- **ABIs** are read live from `contracts/artifacts/contracts/<Name>.sol/<Name>.json`.
- `js/chain.js` — the ethers bridge (provider, per-role signers, `withTx`, event
  hydration helpers `fetchAgreements`/`fetchRecords`).
- `js/ui.js` — shared sidebar chrome (role switcher, connection light, CSV/PDF export).
- `js/views/<page>.js` — per-page data load + form/button wiring.
- ethers v6 is vendored at `vendor/ethers.umd.min.js`, so the dashboard works offline.

The Hardhat keys in `config.js` are the **public, well-known dev keys** — they exist
only on the local chain and control no real funds. Never reuse with a real key.

## File map

```
dashboard/
├── index.html  agreements.html  reports.html  audit.html
├── config.js                 RPC, addresses, role→account, enums
├── vendor/ethers.umd.min.js  vendored ethers v6 browser bundle
└── js/
    ├── chain.js              ethers bridge + shared fetchers + helpers
    ├── ui.js                 role switcher, connection light, CSV/PDF export
    └── views/                overview · agreements · reports · audit
```

The original Stitch design lives in `../macl_accountability_dashboard/` as reference.
