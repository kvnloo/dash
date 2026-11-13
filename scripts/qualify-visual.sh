#!/usr/bin/env bash
# Run only in fleet's disposable MBP copy, never in a served checkout.
set -euo pipefail
if [ -z "${FLEET_BUILD_JDK+x}" ]; then
  printf '%s\n' 'Use fleet-build --node mbp -- bash scripts/qualify-visual.sh' >&2
  exit 2
fi
for dir in node_modules app/node_modules bridge/node_modules; do
  if [ -L "$dir" ]; then unlink "$dir"; fi
done
bun install --frozen-lockfile
(cd app && bun install --frozen-lockfile)
(cd bridge && bun install --frozen-lockfile)
# Fleet intentionally excludes .git. Materialize an index only in this disposable copy for
# the real-workspace inventory test; do not add secrets, dependencies or build artifacts.
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git init -q
  git add app/src bridge/src shared scripts package.json
fi
mkdir -p visual-receipts
set +e
bun app/node_modules/typescript/bin/tsc --noEmit -p app > visual-receipts/typecheck.log 2>&1
printf 'app-typecheck=%s\n' "$?"
bun run test > visual-receipts/tests.log 2>&1
printf 'tests=%s\n' "$?"
bun run lint > visual-receipts/lint.log 2>&1
printf 'lint=%s\n' "$?"
bun scripts/mutate.ts > visual-receipts/mutation.log 2>&1
printf 'mutation=%s\n' "$?"
(cd app && bunx expo export --platform android --output-dir ../visual-android) > visual-receipts/android.log 2>&1
printf 'android=%s\n' "$?"
(cd app && bunx expo export --platform web --output-dir ../visual-web) > visual-receipts/web.log 2>&1
printf 'web=%s\n' "$?"
