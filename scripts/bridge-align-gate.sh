#!/usr/bin/env bash
# Bridge-only gate (MBP via fleet-build). Usage inside the snapshot: bash bridge-align-gate.sh <sha>
set -uo pipefail
mkdir -p .bridge-receipts
echo "revision=$1 host=$(hostname)" | tee .bridge-receipts/validation.log
git init -q 2>/dev/null
bun install --frozen-lockfile > .bridge-receipts/deps.log 2>&1
(cd bridge && bun install --frozen-lockfile) >> .bridge-receipts/deps.log 2>&1
st() { local n=$1; shift; "$@" > ".bridge-receipts/$n.log" 2>&1; echo "$n exit=$?" | tee -a .bridge-receipts/validation.log; }
st typecheck bun bridge/node_modules/typescript/bin/tsc -p bridge --noEmit
st route-contract bun test bridge/src/app-route-contract.test.ts
st context-http bun test bridge/src/context-http.test.ts bridge/src/context-snapshot.test.ts shared/context.test.ts
st bridge-tests bun test bridge/src shared
st python-live-default env -u DASH_HERMES_SOURCE python3 bridge/src/hermes-live.test.py
# Discover an existing compatible Hermes install on this host (read-only; no install/update/config).
{
  for c in "$HOME/.hermes/hermes-agent" /opt/hermes-agent /opt/hermes "$HOME/hermes-agent" /usr/local/lib/hermes-agent; do
    [ -d "$c" ] || continue
    py=""; for p in "$c/venv/bin/python" "$c/.venv/bin/python"; do [ -x "$p" ] && py=$p && break; done
    echo "candidate $c python=${py:-none} rev=$(git -C "$c" rev-parse --short HEAD 2>/dev/null || echo n/a)"
  done
  command -v hermes && readlink -f "$(command -v hermes)"
} > .bridge-receipts/hermes-discovery.log 2>&1
src=$(awk '/python=\//{print $2; exit}' .bridge-receipts/hermes-discovery.log)
py=$(awk '/python=\//{sub("python=","",$3); print $3; exit}' .bridge-receipts/hermes-discovery.log)
if [ -n "$src" ] && [ -n "$py" ]; then
  st python-native-snapshot env DASH_HERMES_SOURCE="$src" "$py" bridge/src/context_snapshot_test.py
  st python-native-live env DASH_HERMES_SOURCE="$src" "$py" bridge/src/hermes-live.test.py
else
  echo "python-native NOT RUN: no Hermes install with a venv found on $(hostname)" | tee -a .bridge-receipts/validation.log
fi
