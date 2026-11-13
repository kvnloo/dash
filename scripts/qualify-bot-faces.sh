#!/usr/bin/env bash
# fleet-build --node mbp --fetch visual-receipts --fetch visual-web -- bash scripts/qualify-bot-faces.sh
set -euo pipefail
[ -n "${FLEET_BUILD_JDK+x}" ] || { printf '%s\n' 'Run through fleet-build in its disposable MBP copy.'; exit 2; }
for dir in node_modules app/node_modules bridge/node_modules; do
  if [ -L "$dir" ]; then unlink "$dir"; fi
done
bun install --frozen-lockfile
(cd app && bun install --frozen-lockfile)
(cd bridge && bun install --frozen-lockfile)
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git init -q
  git add app/src bridge/src shared scripts package.json
fi
mkdir -p visual-receipts
status=0
run_gate() {
  local name=$1
  shift
  if "$@" > "visual-receipts/$name.log" 2>&1; then
    printf '%s=0\n' "$name"
  else
    local rc=$?
    printf '%s=%s\n' "$name" "$rc"
    status=1
  fi
}
run_gate typecheck bun run typecheck
run_gate tests bun run test
run_gate lint bun run lint
run_gate mutation bun scripts/mutate.ts
android() { (cd app && env CI=1 bun node_modules/expo/bin/cli export --platform android --output-dir ../visual-android); }
run_gate android android
(cd app && env CI=1 EXPO_PUBLIC_DEBUG=1 EXPO_PUBLIC_DEBUG_AUTONAV=0 bun node_modules/expo/bin/cli export --platform web --output-dir ../visual-web) > visual-receipts/web.log 2>&1 || status=1
printf 'overall=%s\n' "$status"
exit "$status"
