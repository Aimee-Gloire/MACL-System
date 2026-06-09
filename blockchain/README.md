# MACL Blockchain — 3-node Besu QBFT network

Three Hyperledger Besu validators running QBFT consensus, one per organisation type
(Node-1 = implementing NGO, Node-2 = government M&E, Node-3 = donor).

## Files

| File | Purpose |
|---|---|
| `qbftConfigFile.json` | Network definition: chain config + "generate 3 validator keys" |
| `setup-network.sh` | Generates genesis + keys (via Besu Docker image) and writes the bootnode `.env` |
| `docker-compose.yml` | Runs the 3 validators with fixed IPs; RPC on 8545 / 8546 / 8547 |
| `check-network.sh` | Demo helper: prints validator set + block height per node |

## Run

```bash
./setup-network.sh     # one time (and whenever you reset the chain)
docker compose up      # start all three validators
./check-network.sh     # in another terminal: confirm consensus
```

Stop with `docker compose down`. To reset the chain completely, re-run `./setup-network.sh`
(it clears `networkFiles/`, `Node-*/`, `genesis.json`, and `.env`).

## Notes

- Only Docker is required — Besu runs inside containers, so no local Besu install is needed.
- `chainId` is `1337`; `zeroBaseFee` + huge `gasLimit` keep transactions free on this private chain.
- The generated keys and genesis are git-ignored; anyone cloning regenerates them with the script.
- **BFT caveat:** with 3 validators QBFT tolerates 0 Byzantine faults (`3f+1`). The 2-of-3 finality
  rule still proves no single party controls the ledger — sufficient for this proof-of-concept.
