# RUN-BESU.md — running MACL on the 3-node Besu QBFT network

This is the ordered runbook for bringing up MACL on the 3-node Hyperledger Besu QBFT network in
`blockchain/`. Besu is the chain the system runs on; Hardhat is used only to compile and deploy the
contracts.

Three tiers: browser (`dashboard/`) → REST API (`api/`, port 3001) → Besu chain. The API holds the
signer keys and the chain wiring server-side, and `dashboard/config.js` only points at the API. The
browser never holds keys or talks to the chain directly.

## What you need

- Docker Desktop running (Besu runs in containers, so no local Besu install is needed).
- Node 20, with the contracts deps installed (`cd contracts && npm install`).
- Contracts compiled at least once (`cd contracts && npx hardhat compile`) so the ABIs exist under
  `contracts/artifacts/`.

The three RPC ports are 8545 / 8546 / 8547 (Node-1 / Node-2 / Node-3). Check nothing else is using
them:

```bash
lsof -nP -iTCP:8545 -sTCP:LISTEN   # if it shows a PID, kill it
```

---

## 1. Generate the network and start the 3 validators

```bash
cd blockchain
./setup-network.sh        # one time, and whenever you reset the chain
docker compose up         # starts node1, node2, node3 (leave running)
```

`setup-network.sh` generates the genesis and 3 validator keys and writes the bootnode `.env`. The
genesis funds the deployer and the dashboard's three role accounts, so every on-chain action works.

Each node's JSON-RPC is published on the host's loopback only (`127.0.0.1:8545/8546/8547`, not the
LAN), so only the machine where the API runs can reach it. The nodes also drop the admin RPC API, use
a host allow-list, and scope RPC CORS to the API origin. QBFT and P2P between the containers are
unchanged, so consensus still works.

## 2. Confirm consensus (second terminal)

```bash
cd blockchain
./check-network.sh
```

You should see the QBFT validator set listing all 3 validators, and the same block height (give or
take one) on all three nodes, climbing every ~2 seconds. That is the network agreeing.

## 3. Deploy and wire the contracts onto Besu

```bash
cd contracts
cp .env.example .env       # first time only; holds the deployer key and RPC URL
npm run deploy:besu
```

This deploys Agreement → Compliance → Verification and wires them together.

Verification window: records that don't reach 2-of-3 within a window (default 30 days) become
UNVERIFIED. To demo expiry live, deploy with a short window,
`VERIFICATION_WINDOW_SECONDS=60 npm run deploy:besu`, then submit a report, wait past the window, and
mark it unverified on the Audit Trail page.

On a freshly generated chain the printed addresses are:

| Contract     | Address |
|--------------|---------|
| Agreement    | `0x42699A7612A82f1d9C36148af9C77354759b210b` |
| Compliance   | `0xa50a51c09a5c451C52BB714527E1974b686D8e77` |
| Verification | `0x9a3DBCa554e9f6b9257aAa24010DA8377C57c17e` |

These are pre-filled in `api/.env.example`, so you normally don't touch anything. If you deploy onto a
chain that isn't fresh (deployer nonce not 0), the addresses differ; copy the three printed addresses
into the `*_ADDRESS` entries in `api/.env`.

## 4. Start the REST API

New terminal:

```bash
cd api
npm install                 # first time only
cp .env.example .env        # first time only; signer keys, JWT_SECRET, login hashes (gitignored)
# optional file storage: set DATABASE_URL in api/.env to a Neon or local Postgres, then:
npm run migrate             # creates the documents table
npm start                   # listens on http://127.0.0.1:3001 (leave running)
```

The API loads the three signer keys from `api/.env`, reads the contract ABIs from
`contracts/artifacts/`, stores uploaded evidence files keyed by their SHA-256, authenticates each org
via JWT login, and is the only thing that talks to the validators' RPC. You should see
`MACL API listening on http://127.0.0.1:3001`.

`JWT_SECRET` is required (32+ chars, or the API won't start; generate one with `openssl rand -hex 32`).
Login passwords are stored as bcrypt hashes: for each org run `node scripts/hash-password.js
'<password>'` and paste the hash into `DONOR_PW_HASH` / `NGO_PW_HASH` / `AUDIT_PW_HASH` (and
`ADMIN_PW_HASH` for the admin login). Document storage is optional: leave `DATABASE_URL` unset and the
upload/verify endpoints return 503 while every other flow works.

## 5. Serve the dashboard

From the repo root, new terminal:

```bash
npx http-server -p 8080 -c-1
```

Open <http://127.0.0.1:8080/dashboard/> and you're redirected to the sign-in page. Log in as an org,
and the connection light (bottom-left) goes green with `connected · block #…`, rising every couple of
seconds. If it says "API unreachable", the API (step 4) isn't running on port 3001. To switch org,
sign out and sign in as that org.

CORS is pinned to the dashboard origin (`http://localhost:8080` and `http://127.0.0.1:8080` by
default). Serving from a different host or port? Set `CORS_ORIGIN` in `api/.env` to that exact origin
and restart the API.

## 6. Confirm the full flows work

Run the accountability flows end to end (blocks settle in ~2s):

1. Agreements (as Donor): create an agreement and add a target.
2. Budget & Spend (as Donor): set its budget, then finalise the agreement.
3. Reports (as NGO): submit a report and watch it evaluate PASS/FAIL/FLAG.
4. Audit Trail (each org in turn): endorse with two different organisations; it finalises at 2-of-3
   and shows the block hash and integrity badge.
5. Budget & Spend (as NGO): raise a spend request with a supporting document; sign in as the two
   other orgs and endorse (the NGO can't approve its own); remaining budget drops; back as NGO, mark
   it as spent with a receipt.
6. View / Verify (any org): a stored document shows View (opens the file) and Verify (the server
   re-hashes the stored file against the on-chain hash and reports verified or not verified).

Re-run `blockchain/check-network.sh` afterwards: all three nodes report the same height, showing every
node holds the identical ledger.

---

## 7. Cross-node integrity and tamper-resistance

This shows that no single node can quietly rewrite the ledger. A node taken offline or tampered is
flagged, the 2-of-3 majority keeps the correct record, and on rejoin the odd node is forced to resync
and its divergence is discarded. This is the basis of the RQ3 tamper-resistance evaluation.

Where it's visible in the dashboard:

- Overview → Network Integrity panel queries all three node RPCs and shows each as in sync, behind,
  diverged, or not responding, with a live height per node.
- Audit Trail / Budget & Spend → integrity badge asks every node for that exact record and reports
  cross-node agreement ("verified across 3 nodes", or "2 of 3 nodes agree" when one is out).

Procedure (helper script: `blockchain/tamper-demo.sh`):

1. With all three nodes up, the Overview shows 3 nodes in sync and a finalised record's badge reads
   "verified across 3 nodes".
2. Take one node off the network:

   ```bash
   cd blockchain && ./tamper-demo.sh stop 3
   ```

   Within a few seconds the Overview flags Node-3 as not responding while Node-1 and Node-2 keep
   advancing (the 2-of-3 quorum still produces blocks).
3. Create a new record on the majority while Node-3 is down (submit a report and endorse it 2-of-3,
   or raise and approve a spend request). It finalises normally, and its badge reads "2 of 3 nodes
   agree": Node-3 never saw it, but the majority record stands.
4. Bring the node back:

   ```bash
   ./tamper-demo.sh start 3
   ```

   Node-3 restarts and resyncs to the majority chain within a few blocks (watch its height match in
   `./tamper-demo.sh status`). The badges return to "verified across 3 nodes". The node could not keep
   a divergent version; it had to adopt the canonical chain.

Framing: the blockchain makes tampering detectable and rejected by the majority. One node cannot forge
or hide a record, and a diverged node is overruled and overwritten by the 2-of-3 majority. It does not
physically prevent wrongdoing outside the system (for example how real money is actually spent); it
guarantees the record is tamper-evident and agreed by independent organisations.

## Reset / stop

- Stop the network: Ctrl+C in the `docker compose up` terminal, then `docker compose down`.
- Stop the API: Ctrl+C in the `npm start` terminal.
- Full reset (wipe the chain): `cd blockchain && ./setup-network.sh` again, then `docker compose up`.
  This regenerates from genesis, so the deployer nonce is back to 0 and the pre-filled addresses in
  `api/.env` match again after you re-run `npm run deploy:besu`.

## Troubleshooting

- `EADDRINUSE` / port busy: an old container or process is on 8545/6/7. Stop it (`lsof -nP
  -iTCP:8545 -sTCP:LISTEN`, then kill the PID) or `docker compose down`.
- Connection light red, "API unreachable": the API isn't running on port 3001, or
  `dashboard/config.js` `API_BASE` points elsewhere.
- API logs a chain error, or writes revert with a connection error: Docker isn't up, the containers
  aren't running, or `BESU_RPC_URL` / `NODE_RPC_URLS` in `api/.env` are wrong.
- "no such contract" reverts: you haven't run `npm run deploy:besu` on this chain, or the `*_ADDRESS`
  values in `api/.env` don't match the deploy.
- A write fails with "insufficient funds": the chain was generated before the role accounts were
  funded. Re-run `./setup-network.sh`.
- Blocks not advancing: fewer than the required validators are up. Check all three containers are
  running (`docker compose ps`).
