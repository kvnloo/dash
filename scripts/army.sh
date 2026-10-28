#!/usr/bin/env bash
# The Dash test suite: the e2e tester army (e2e/mbp-army) on this exact commit.
#
#   bun run test                    # = scripts/army.sh
#   ARMY_WORKERS=4 scripts/army.sh
#
# Steps: web export of app/ at HEAD -> local static server -> headless Playwright army
# against the real bridge + fixture ACP agent -> O15 receipt (e2e/mbp-army/receipt.py)
# for HEAD under artifacts/army/<sha>/receipt and $DASH_ARMY_RECEIPTS/<sha>.
# Exit 0 only when every test passed and every inventoried feature is covered.
# Needs: bun, node, bwrap (unprivileged user namespaces), Playwright Chromium.
# Never touches a display or a phone. The MBP headed variant is e2e/mbp-army/run.py.
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD
sha=$(git rev-parse HEAD)
out=${ARMY_OUT:-$root/artifacts/army/$sha}
workers=${ARMY_WORKERS:-4}
port=${ARMY_PORT:-$((18400 + RANDOM % 500))}
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
rm -rf "$out"; mkdir -p "$out/tmp"

if [ -z "${ARMY_WEB:-}" ]; then
  if [ -z "${ARMY_WEB_EXPORT:-}" ]; then
    echo "army: exporting web build of $sha"
    (cd app && CI=1 EXPO_PUBLIC_DEBUG=0 EXPO_PUBLIC_DEBUG_AUTONAV=0 \
      bun node_modules/expo/bin/cli export --platform web --output-dir "$out/web-export") >"$out/web-export.log" 2>&1 \
      || { tail -40 "$out/web-export.log"; echo "army: web export failed" >&2; exit 1; }
    ARMY_WEB_EXPORT=$out/web-export
  fi
  python3 e2e/mbp-army/serve.py "$ARMY_WEB_EXPORT" "$port" >"$out/serve.log" 2>&1 &
  server=$!
  trap 'kill $server 2>/dev/null || true' EXIT
  for _ in $(seq 1 60); do curl -fs "http://127.0.0.1:$port/" >/dev/null && break; sleep 0.5; done
  export ARMY_WEB="http://127.0.0.1:$port"
fi

export ARMY_TMP=$out/tmp ARMY_OUTPUT=$out/test-results ARMY_HTML=$out/html ARMY_JSON=$out/results.json \
  ARMY_STARTUP=$out/startup.json ARMY_COMMAND_STARTED=$(date +%s%3N) ARMY_BRIDGE_ROOT=$root
unset ARMY_HEADED
set +e
node node_modules/playwright/cli.js test -c e2e/mbp-army/playwright.config.ts --workers="$workers" 2>&1 | tee "$out/army.log"
pw=${PIPESTATUS[0]}
set -e
[ -f "$out/results.json" ] || { echo "army: Playwright wrote no report (exit $pw)" >&2; exit 1; }
rc=0
python3 e2e/mbp-army/receipt.py "$out/results.json" "$out" --started "$started" || rc=$?
exit $(( pw != 0 ? pw : rc ))
