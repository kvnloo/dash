#!/usr/bin/env bash
# Job for fleet-build --node mbp: install, typecheck, kit freshness, web export and the two OpenUI army specs.
set -uo pipefail
[ -L app/node_modules ] && rm app/node_modules  # groot-only Metro overlay link
out=$PWD/.eui-receipts; rm -rf "$out"; mkdir -p "$out"
step() { local name=$1; shift; echo "== $name"; ( "$@" ) >"$out/$name.log" 2>&1; local rc=$?; echo "$name rc=$rc" | tee -a "$out/summary.txt"; tail -25 "$out/$name.log"; return $rc; }
step install bash -c 'bun install --frozen-lockfile && bun scripts/install-public-ci.ts && bun install --frozen-lockfile --cwd bridge' || exit 1
step typecheck bun run typecheck
# kit-check runs on groot (pod git lacks CA trust)
: step kit-check bash -c 'git clone -q https://github.com/kvnloo/ephemeral-ui.git /tmp/eui-$$ && git -C /tmp/eui-$$ checkout -q 63e06b29ffb0d7c5b9d482abebc0312335897321 && ESBUILD=$PWD/app/node_modules/esbuild/lib/main.js node app/scripts/ephemeral-kit/build.mjs --kit /tmp/eui-$$ --check'
step chromium node node_modules/playwright/cli.js install chromium
step export bash -c 'cd app && CI=1 EXPO_PUBLIC_DEBUG=0 EXPO_PUBLIC_DEBUG_AUTONAV=0 EXPO_PUBLIC_DASH_VOICE_FAKE=1 bun node_modules/expo/bin/cli export --platform web --output-dir '"$out"'/web-export' || exit 1
port=$((18400 + RANDOM % 500))
python3 e2e/mbp-army/serve.py "$out/web-export" "$port" >"$out/serve.log" 2>&1 & server=$!
trap 'kill $server 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -fs "http://127.0.0.1:$port/" >/dev/null && break; sleep 0.5; done
export ARMY_WEB="http://127.0.0.1:$port" ARMY_TMP=$out/tmp ARMY_OUTPUT=$out/test-results ARMY_HTML=$out/html ARMY_JSON=$out/results.json ARMY_STARTUP=$out/startup.json ARMY_COMMAND_STARTED=$(date +%s%3N) ARMY_BRIDGE_ROOT=$PWD
mkdir -p "$ARMY_TMP"; unset ARMY_HEADED
step army node node_modules/playwright/cli.js test -c e2e/mbp-army/playwright.config.ts --workers=2 e2e/mbp-army/ephemeral-cards.spec.ts e2e/mbp-army/openui-native.spec.ts
grep -m4 -B2 -A25 "Error:" "$out/army.log" | cut -c1-240
for f in "$out"/test-results/*/error-context.md; do echo "== $f"; head -c 1500 "$f"; echo; break; done
rm -rf "$out/web-export" "$out/tmp"
cat "$out/summary.txt"
