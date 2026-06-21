#!/usr/bin/env bash
# Confirms the 3-node QBFT network is healthy: validator set + latest block per node.
# Use this in the demo to show all three nodes agree on the same chain.
set -euo pipefail

declare -a PORTS=("8545" "8546" "8547")
declare -a NAMES=("Node-1 (NGO)" "Node-2 (Ministry)" "Node-3 (Donor)")

# Use 127.0.0.1 (not localhost): the node RPC ports are published on the host's
# IPv4 loopback only (S4/F-05), and "localhost" can resolve to IPv6 ::1 first.
rpc() { curl -s -X POST --data "$2" "127.0.0.1:$1/" -H "Content-Type: application/json"; }

echo "== QBFT validator set (from Node-1) =="
rpc 8545 '{"jsonrpc":"2.0","method":"qbft_getValidatorsByBlockNumber","params":["latest"],"id":1}' | python3 -m json.tool

echo ""
echo "== Latest block height per node (should match across all three) =="
for i in 0 1 2; do
  HEX=$(rpc "${PORTS[$i]}" '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | python3 -c "import sys,json;print(json.load(sys.stdin)['result'])")
  printf "  %-20s block %d\n" "${NAMES[$i]}" "$((HEX))"
done
