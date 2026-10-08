#!/usr/bin/env bash
# Reproducible CRE simulation of both workflows against a local anvil fork of Monad testnet.
#
#   pnpm cre:simulate            (from the repo root; or `bun run simulate` in cre/)
#
# 1. Forks Monad testnet ~10 minutes in the past with anvil (Foundry).
# 2. scripts/fork-setup.ts deploys FanoutKeeper on the fork (MockKeystoneForwarder as forwarder),
#    creates an expired and an open payout, pre-signs two scheduled payouts, and writes
#    config.local.json for both workflows.
# 3. scripts/local-services.ts serves the indexer query and the schedule file from the fork's state.
# 4. If the CRE CLI is logged in (`cre whoami`), runs
#      cre workflow simulate <workflow> --target local-simulation --broadcast
#    for both workflows. If not, prints how to log in and delivers the same reports through the
#    fork's MockKeystoneForwarder with scripts/deliver-local.ts instead.
# 5. scripts/check-local.ts checks the result onchain: expired rows refunded, the open row untouched,
#    the scheduled payout created.
#
# Needs: anvil, bun, the CRE CLI (https://docs.chain.link/cre/getting-started/cli-installation),
# and `pnpm install` at the repo root. Uses only anvil's public dev accounts; no real keys.
set -euo pipefail

CRE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$CRE_DIR/.." && pwd)"
UPSTREAM_RPC="${MONAD_RPC_URL:-https://testnet-rpc.monad.xyz}"
PORT=8545
FORK_BLOCKS_BACK="${FORK_BLOCKS_BACK:-2000}" # ~0.3 s blocks: about 10 minutes
LOCAL="$CRE_DIR/.local"
mkdir -p "$LOCAL"
export PATH="$HOME/.cre/bin:$PATH"

pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT

echo "== Installing workflow dependencies and building contracts"
(cd "$CRE_DIR" && bun install --silent && bun install --silent --cwd refund-expired && bun install --silent --cwd scheduled-payouts)
pnpm --dir "$ROOT" --filter smart-contract build >/dev/null

latest=$(cast block-number --rpc-url "$UPSTREAM_RPC")
fork_block=$((latest - FORK_BLOCKS_BACK))
echo "== Forking Monad testnet at block $fork_block (latest $latest)"
anvil --fork-url "$UPSTREAM_RPC" --fork-block-number "$fork_block" --port "$PORT" --chain-id 10143 > "$LOCAL/anvil.log" 2>&1 &
pids+=($!)
for _ in $(seq 1 60); do cast chain-id --rpc-url "http://127.0.0.1:$PORT" >/dev/null 2>&1 && break; sleep 0.5; done

echo "== Setting up the fork"
(cd "$CRE_DIR" && bun scripts/fork-setup.ts)

echo "== Starting the indexer and schedule stand-ins"
bun "$CRE_DIR/scripts/local-services.ts" > "$LOCAL/services.log" 2>&1 &
pids+=($!)
sleep 1

if cre whoami >/dev/null 2>&1; then
  # anvil dev account 3 signs the simulator's transactions; it exists only on the fork.
  key=$(cd "$CRE_DIR" && bun -e 'import { devPrivateKey } from "./scripts/local-chain.ts"; console.log(devPrivateKey(3).slice(2))')
  cast rpc anvil_setBalance "$(cast wallet address "0x$key")" 0x56BC75E2D63100000 --rpc-url "http://127.0.0.1:$PORT" >/dev/null
  printf 'CRE_ETH_PRIVATE_KEY=%s\n' "$key" > "$LOCAL/sim.env"
  for wf in refund-expired scheduled-payouts; do
    echo "== cre workflow simulate $wf --target local-simulation --broadcast"
    (cd "$CRE_DIR" && cre workflow simulate "$wf" --target local-simulation --broadcast \
      --non-interactive --trigger-index 0 -e "$LOCAL/sim.env") | tee "$LOCAL/simulate-$wf.log"
  done
else
  cat <<'EOF'
== The CRE CLI is not logged in, so `cre workflow simulate` can't run (it needs a CRE account).
   To run it: create an account at https://cre.chain.link, then `cre login` (or export CRE_API_KEY),
   and run this script again.
== Meanwhile: delivering the same reports through the fork's MockKeystoneForwarder
EOF
  (cd "$CRE_DIR" && bun scripts/deliver-local.ts)
fi

echo "== Checking the fork"
(cd "$CRE_DIR" && bun scripts/check-local.ts)
