#!/usr/bin/env bash
# Tamper / out-of-sync demonstration helper for the 3-node QBFT network.
#
# QBFT means a single node CANNOT fork the ledger: if a node is taken offline
# (or its data tampered), the 2-of-3 majority keeps producing the canonical
# chain, the dashboard flags the odd node out, and on rejoin that node is FORCED
# to resync to the majority — its divergence is discarded. This script drives
# that demo; the dashboard's Network Integrity panel + record badges show it.
#
# Usage:
#   ./tamper-demo.sh status            # heights per node + the QBFT validator set
#   ./tamper-demo.sh stop  <1|2|3>     # take a node OFF the network (simulate tamper/outage)
#   ./tamper-demo.sh start <1|2|3>     # bring it back — watch it resync to the majority
set -euo pipefail
cd "$(dirname "$0")"

declare -a PORTS=("8545" "8546" "8547")
declare -a NAMES=("Node-1 (NGO)" "Node-2 (Ministry)" "Node-3 (Donor)")

# Use 127.0.0.1 (not localhost): the node RPC ports are published on the host's
# IPv4 loopback only (S4/F-05), and "localhost" can resolve to IPv6 ::1 first.
rpc()    { curl -s -X POST --data "$2" "127.0.0.1:$1/" -H "Content-Type: application/json" 2>/dev/null; }
height() { rpc "$1" '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
           | python3 -c "import sys,json;print(int(json.load(sys.stdin)['result'],16))" 2>/dev/null || echo "DOWN"; }

status() {
  echo "== Node heights (should match across all UP nodes) =="
  for i in 0 1 2; do printf "  %-20s %s\n" "${NAMES[$i]}" "$(height "${PORTS[$i]}")"; done
  echo "== QBFT validator set =="
  for p in 8545 8546 8547; do
    OUT=$(rpc "$p" '{"jsonrpc":"2.0","method":"qbft_getValidatorsByBlockNumber","params":["latest"],"id":1}')
    if [ -n "$OUT" ]; then echo "$OUT" | python3 -m json.tool 2>/dev/null && break; fi
  done
}

case "${1:-status}" in
  status) status ;;
  stop)
    n="${2:?usage: ./tamper-demo.sh stop <1|2|3>}"
    docker compose stop "node$n"
    echo ">> Stopped node$n. The other two (2-of-3 quorum) keep producing the canonical chain."
    echo ">> In the dashboard: Overview flags node$n red; new records read '2 of 3 nodes agree'." ;;
  start)
    n="${2:?usage: ./tamper-demo.sh start <1|2|3>}"
    docker compose start "node$n"
    echo ">> Started node$n. It will resync to the 2-of-3 majority chain within a few blocks,"
    echo ">> discarding any divergence. Badges return to 'verified across 3 nodes'." ;;
  *) echo "usage: $0 {status | stop <1|2|3> | start <1|2|3>}"; exit 1 ;;
esac
