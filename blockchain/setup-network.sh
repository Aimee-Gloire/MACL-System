#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

BESU_IMAGE="hyperledger/besu:latest"
declare -a IPS=("172.16.239.11" "172.16.239.12" "172.16.239.13")

echo "==> Cleaning previous network files (root container removes root-owned leftovers)"
docker run --rm --user 0 -v "$PWD":/cfg -w /cfg --entrypoint sh "$BESU_IMAGE" \
  -c "rm -rf networkFiles genesis.json Node-1 Node-2 Node-3 .env" 2>/dev/null || true
rm -rf networkFiles genesis.json Node-1 Node-2 Node-3 .env 2>/dev/null || true

echo "==> Generating genesis + 3 validator keys (via Besu Docker image)"
docker run --rm -v "$PWD":/cfg -w /cfg "$BESU_IMAGE" \
  operator generate-blockchain-config \
  --config-file=qbftConfigFile.json \
  --to=networkFiles \
  --private-key-file-name=key

echo "==> Handing generated files back to you (Besu writes them as root)"
docker run --rm --user 0 -v "$PWD":/cfg -w /cfg --entrypoint sh "$BESU_IMAGE" \
  -c "chown -R $(id -u):$(id -g) networkFiles"

cp networkFiles/genesis.json .

echo "==> Laying out node data directories"
i=1
for keydir in networkFiles/keys/*/; do
  mkdir -p "Node-$i/data"
  cp "$keydir"key "Node-$i/data/key"
  cp "$keydir"key.pub "Node-$i/data/key.pub"
  echo "    Node-$i  <-  $(basename "$keydir")"
  i=$((i+1))
done

PUBKEY=$(cat Node-1/data/key.pub)
PUBKEY=${PUBKEY#0x}
echo "BOOTNODE_ENODE=enode://${PUBKEY}@${IPS[0]}:30303" > .env

echo "==> Wrote .env with BOOTNODE_ENODE"
cat .env
echo ""
echo "Done. Start the network with:  docker compose up"