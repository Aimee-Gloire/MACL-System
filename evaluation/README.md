# MACL evaluation — PostgreSQL baseline + tamper metrics (RQ3)

This folder is the **control group** for the research evaluation. It is kept
entirely separate from MACL and never touches the contracts. It compares the
3-node Besu MACL system against a **centralised PostgreSQL store** holding the
same programme data, by applying the *same* tamper to each and recording the
three metrics promised in the proposal (Objective 3 / RQ3):

| # | Metric | What it shows |
|---|--------|---------------|
| 1 | **Tamper-detection latency** | How fast each system detects an altered figure. MACL detects via the cross-node integrity check; the centralised store has no independent reference, so the tamper silently becomes the new truth. |
| 2 | **Consensus recovery time** | How long a tampered/offline MACL validator takes to resync to the 2-of-3 majority. The single Postgres instance has no consensus to recover with (N/A). |
| 3 | **Audit-trail completeness** | How much of an indicator's history each system can reproduce. MACL appends an immutable record per change (100%); the centralised store overwrites in place (only the latest survives). |

The output is a results table (`results/metrics.md` and `results/metrics.csv`)
for the evaluation chapter.

## Why this design is a fair control

The Postgres schema ([schema.sql](schema.sql)) deliberately mirrors MACL's data
but is a **plain, single, mutable store** — no replication, no audit/history
table, no row fingerprints. That is exactly the centralised design the proposal
sets out to compare against; the metrics measure the consequences of those gaps.

## Layout

```
evaluation/
  docker-compose.yml      Postgres 16 (the baseline), ephemeral + reproducible
  schema.sql              baseline tables mirroring MACL (loaded on container init)
  .env.example            copy to .env and adjust
  seed.js                 seed MACL canonically, then mirror the same rows to Postgres
  run-evaluation.js       run all metrics, write the results table
  lib/                    macl.js (Besu+contracts), db.js (pg), report.js, util.js
  metrics/                tamper-detection.js, consensus-recovery.js, audit-completeness.js
  results/                generated metrics.md / metrics.csv (gitignored)
```

## Prerequisites

1. **MACL up and deployed.** Bring up the 3-node Besu network and deploy the
   contracts (the deploy seeds the on-chain org registry, which `seed.js` needs):
   - Terminal A: `cd ../blockchain && ./setup-network.sh && docker compose up`
   - Terminal B: `cd ../contracts && npm run deploy:besu`
     (copy any printed addresses into `../api/.env` if they changed)
2. **Node deps:** `cd evaluation && npm install`
3. **Config:** `cp .env.example .env` (defaults match the fresh-chain addresses in `../api/.env.example`).

## Run it

```bash
cd evaluation

# 1) start the PostgreSQL baseline (control group)
docker compose up -d

# 2) seed BOTH systems with identical data
npm run seed

# 3) run the comparison and write the results table
npm run evaluate
#    add --no-consensus to skip the metric that stops/starts a Besu node:
#    npm run evaluate -- --no-consensus
```

Results are printed and written to `results/metrics.md` and `results/metrics.csv`.

## Reproducibility notes

- The metrics **mutate state** (they tamper the baseline row and append MACL
  records). Re-run `npm run seed` before each fresh evaluation pass.
- The Postgres container has **no named volume**, so `docker compose down && up`
  resets it to a clean schema.
- The consensus-recovery metric stops and restarts a validator via
  `../blockchain/tamper-demo.sh`; the network heals automatically, but expect a
  short interruption while the node rejoins.
- Tunables live in `.env`: `EVAL_HISTORY_DEPTH`, `EVAL_RECOVERY_NODE`,
  `EVAL_RECOVERY_TIMEOUT`.
