# RUN-BESU.md — running MACL on the 3-node Besu QBFT network

This is the exact, ordered runbook for bringing up MACL on the **3-node Hyperledger Besu QBFT**
network in `blockchain/`. Besu is the chain the system runs on; Hardhat is used only to compile
and deploy the contracts.

> **Three tiers:** browser (`dashboard/`) → REST API (`api/`, port 3001) → Besu chain. The API holds
> the signer keys and the chain wiring server-side; `dashboard/config.js` only points at the API
> (`API_BASE`). The browser never holds keys or talks to the chain directly. Besu is the single chain.

## What you need
- **Docker Desktop running** (Besu runs in containers — no local Besu install needed).
- **Node 20** + the contracts deps installed (`cd contracts && npm install`).
- Contracts compiled at least once (`cd contracts && npx hardhat compile`) so the ABIs exist
  under `contracts/artifacts/…` — the dashboard reads them from there.

The three RPC ports are **8545 / 8546 / 8547** (Node-1 / Node-2 / Node-3). Make sure nothing
else is using them first:
```bash
lsof -nP -iTCP:8545 -sTCP:LISTEN   # if it shows a PID, `kill <pid>`
```

---

## 1. Generate the network and start the 3 validators
```bash
cd blockchain
./setup-network.sh        # one time, and whenever you RESET the chain
docker compose up         # starts node1, node2, node3 (leave this running)
```
`setup-network.sh` generates the genesis + 3 validator keys and writes the bootnode `.env`.
The genesis funds the deployer **and** the dashboard's three role accounts, so every on-chain
action works.

> **RPC is locked down (S4 / F-05).** Each node's JSON-RPC is published on the host's **loopback
> only** (`127.0.0.1:8545/8546/8547`, not the LAN), so only this machine — where the API runs — can
> reach it. The nodes also run with: the **`ADMIN` API dropped** (`--rpc-http-api=ETH,NET,QBFT,WEB3`),
> a **host allow-list** (`--host-allowlist=127.0.0.1,localhost`, which rejects RPC carrying any other
> `Host` header — anti DNS-rebinding), and **scoped CORS** (`--rpc-http-cors-origins=http://127.0.0.1:3001`,
> i.e. only the API may call the RPC from a browser, instead of `all`). QBFT/P2P between the
> containers is unchanged, so consensus still works. The API reaches the nodes over `127.0.0.1`, so
> all flows keep working; nothing on the LAN can poke the validators.

## 2. Confirm consensus (in a second terminal)
```bash
cd blockchain
./check-network.sh
```
You should see the **QBFT validator set listing all 3 validators**, and the **same block height**
(give or take one) on all three nodes, climbing every ~2 seconds. That is the network agreeing.

## 3. Deploy + wire the contracts onto Besu
```bash
cd contracts
cp .env.example .env       # first time only — holds the genesis deployer key + RPC URL
npm run deploy:besu
```
This deploys Agreement → Compliance → Verification and wires them
(`setVerificationContract`, `setComplianceContract`).

> **BL-9 verification window:** records that don't reach 2-of-3 within a window (default **30 days**)
> become **UNVERIFIED**. To demo expiry live, deploy with a short window:
> `VERIFICATION_WINDOW_SECONDS=60 npm run deploy:besu`. (Or change it later from the deployer:
> `cd contracts && npx hardhat console --network besu` → `const v = await ethers.getContractAt("VerificationWorkflowContract", "<addr>"); await v.setVerificationWindow(60);`.)
> Then submit a report, wait past the window, and on **Audit Trail** the record shows **Window passed**
> with a **Mark unverified** action.

On a **freshly generated** chain (step 1) the printed addresses will be:

| Contract     | Address |
|--------------|---------|
| Agreement    | `0x42699A7612A82f1d9C36148af9C77354759b210b` |
| Compliance   | `0xa50a51c09a5c451C52BB714527E1974b686D8e77` |
| Verification | `0x9a3DBCa554e9f6b9257aAa24010DA8377C57c17e` |

These are already pre-filled in `api/.env.example`, so you normally **don't have to touch
anything**. If you ever deploy onto a chain that is *not* fresh (the deployer's nonce isn't 0), the
addresses will differ — copy the three printed addresses into the `*_ADDRESS` entries in `api/.env`.

## 4. Start the REST API (the broker between dashboard and chain)
In a new terminal:
```bash
cd api
npm install                 # first time only
cp .env.example .env        # first time only — signer keys, JWT_SECRET + login hashes (gitignored)
# Document storage (BL-12): set DATABASE_URL in api/.env to your Neon (or local) Postgres, then:
npm run migrate             # first time only — creates the `documents` table
npm start                   # listens on http://127.0.0.1:3001 (leave this running)
```
The API loads the three signer keys from `api/.env` (TEST keys for the permissioned network), reads
the contract ABIs from `contracts/artifacts/…`, stores uploaded evidence files in Neon/Postgres
keyed by their SHA-256, authenticates each org via JWT login, and is the only thing that talks to the
validators' RPC. You should see `MACL API listening on http://127.0.0.1:3001`,
`documents : Neon/Postgres store ready` and `auth : JWT login enabled`.

> **Auth is hardened (S1).** `JWT_SECRET` is **required and fail-closed** — the API refuses to start
> if it's missing or shorter than 32 chars (`openssl rand -hex 32`). Login passwords are **bcrypt
> hashes**, not plaintext: for each org run `node scripts/hash-password.js '<password>'` and paste the
> hash into `DONOR_PW_HASH` / `NGO_PW_HASH` / `AUDIT_PW_HASH` (and `ADMIN_PW_HASH` for the admin login
> that registers organisations, S3). A role with no hash simply can't log in.
>
> Document storage is optional to *boot* the API: leave `DATABASE_URL` unset and the upload/download/
> verify endpoints return 503 while every other flow works. To attach/verify files, set it + migrate.
> Get a free connection string from the Neon console, or point at any Postgres (e.g. a local one).

## 5. Serve the dashboard and confirm
From the **repo root** (in a new terminal):
```bash
npx http-server -p 8080 -c-1
```
Open **http://127.0.0.1:8080/dashboard/** → you're redirected to the **sign-in** page. Log in as an
org (e.g. Donor-Admin, using the password whose hash you set in step 4). The connection light (bottom-left) should go
**green — "connected · block #…"**, with the block number rising every couple of seconds.
If it says *API unreachable*, the API (step 4) isn't running on port 3001. The header shows
**Signed in as …** with a **Sign out** button; switching org = sign out and sign in as that org.

> **CORS is pinned (S4 / F-10).** The API only accepts browser calls from the dashboard origin —
> `http://localhost:8080` and `http://127.0.0.1:8080` by default (not `*`). Open the dashboard on one
> of those. Serving it from a different host/port? Set `CORS_ORIGIN` in `api/.env` to that exact
> origin (comma-separate several) and restart the API.

## 6. Confirm the full flows work on Besu
Run the accountability flows end-to-end (blocks settle in ~2s as QBFT reaches consensus):
1. **Agreements** (signed in as Donor-Admin): create an agreement → add a target.
2. **Budget & Spend** (as Donor-Admin): set its budget → then finalise the agreement on the
   Agreements page.
3. **Reports** (sign out, sign in as NGO): submit a report → watch it evaluate PASS/FAIL/FLAG.
4. **Audit Trail** (sign in as each org in turn): endorse with two **different** organisations → it
   finalises at 2-of-3 and shows the finalised block hash + integrity badge.
5. **Budget & Spend** (as NGO): raise a spend request with a supporting document → sign in as the
   **two other** orgs and endorse (the NGO can't approve its own) → remaining budget drops → back as
   NGO, **Mark as spent** with a receipt file.
6. **View / Verify** (any org): on Reports, Budget & Spend or Audit Trail, any stored document shows
   **View** (opens the stored file) and **Verify** (the server re-hashes the stored file against the
   on-chain hash → ✓ Verified / ✗ Not verified). No file picking; all via the authenticated API.

Re-run `blockchain/check-network.sh` afterwards: all three nodes still report the same height,
proving every node holds the identical ledger.

---

## 7. Cross-node integrity and tamper-resistance
This demonstrates that no single node can quietly rewrite the ledger: a node taken offline (or
tampered) is **flagged**, the 2-of-3 majority keeps the correct record, and on rejoin the odd node
is **forced to resync** — its divergence is discarded. This is the basis of the RQ3
tamper-resistance evaluation.

What makes it visible in the dashboard:
- **Overview → Network Integrity panel** queries all three node RPCs and shows each as
  *in sync / behind / diverged / not responding*, with a live height per node (refreshes every few seconds).
- **Audit Trail / Budget & Spend → integrity badge** asks every node for that exact record and
  reports cross-node agreement: **"verified across 3 nodes"** when all agree, or **"2 of 3 nodes agree"** when one is out.

Procedure (helper script: `blockchain/tamper-demo.sh`):
1. With all three nodes up, open the dashboard. Overview shows **3 nodes in sync**; on Audit Trail a
   finalised record's badge reads **"verified across 3 nodes"**. Baseline established.
2. **Take one node off the network** (simulating a tampered/rogue/offline node):
   ```bash
   cd blockchain && ./tamper-demo.sh stop 3
   ```
   Within a few seconds Overview flags **Node-3 "not responding"** while Node-1 and Node-2 keep
   advancing (the 2-of-3 quorum still produces blocks).
3. **Create a new record on the majority** while Node-3 is down — e.g. submit a report and endorse it
   2-of-3, or raise + approve a spend request. It finalises normally. Its integrity badge now reads
   **"2 of 3 nodes agree"**: Node-3 never saw it, but the majority record stands and is authoritative.
4. **Bring the node back:**
   ```bash
   ./tamper-demo.sh start 3
   ```
   Node-3 restarts and **resyncs to the 2-of-3 majority chain** within a few blocks (watch its height
   jump to match in `./tamper-demo.sh status`). The badges return to **"verified across 3 nodes"**.
   The node could not keep a divergent version — it had to adopt the canonical chain.

**Honest framing:** the blockchain makes tampering **detectable and rejected by the majority** —
one node cannot forge or hide a record, and a diverged node is overruled and overwritten by the
2-of-3 majority. It does **not** physically prevent wrongdoing *outside* the system (e.g. how the
real money is actually spent); it guarantees the *record* is tamper-evident and agreed by
independent organisations.

## Reset / stop
- Stop the network: `Ctrl+C` in the `docker compose up` terminal, then `docker compose down`.
- Stop the API: `Ctrl+C` in the `npm start` (api) terminal.
- **Full reset** (wipe the chain and start clean): `cd blockchain && ./setup-network.sh` again,
  then `docker compose up`. Because this regenerates from genesis, the deployer's nonce is back
  to 0 and the pre-filled addresses in `api/.env` will match again after you
  re-run `npm run deploy:besu`.

## Troubleshooting
- **`EADDRINUSE` / port busy** — an old container (or another process) is on 8545/6/7. Stop it
  (`lsof -nP -iTCP:8545 -sTCP:LISTEN` → `kill <pid>`) or `docker compose down`.
- **Connection light red, "API unreachable"** — the API (`cd api && npm start`) isn't running on
  port 3001, or `dashboard/config.js` `API_BASE` points elsewhere.
- **API logs a chain error / writes revert with a connection error** — Docker isn't up, the
  containers aren't running, or `BESU_RPC_URL` / `NODE_RPC_URLS` in `api/.env` are wrong.
- **"contracts missing" / reverts about no such contract** — you haven't run `npm run deploy:besu`
  on this chain, or the `*_ADDRESS` values in `api/.env` don't match the deploy (paste the printed ones).
- **A write fails with "insufficient funds"** — you're on a chain generated *before* the role
  accounts were funded. Re-run `./setup-network.sh` (the current genesis funds all three roles).
- **Blocks not advancing** — fewer than the required validators are up. QBFT with 3 validators
  needs a quorum; check all three containers are running (`docker compose ps`).
