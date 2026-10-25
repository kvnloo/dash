#!/usr/bin/env bash
set -euo pipefail
source_dir="$PWD"
cache="$HOME/.cache/dash-interaction-repair-native-20261022"
build="$HOME/.cache/dash-spen-render-20261025"
mkdir -p "$build"
exec 9>"$build.lock"
flock -n 9 || exit 75
rsync -a --delete --exclude=node_modules --exclude=/.git --exclude=/.repair-receipts/ --exclude=/app/android/ ./ "$build/"
cd "$build"
[ -L app/node_modules ] || ln -s "$cache/app/node_modules" app/node_modules
[ -L node_modules ] || ln -s "$cache/node_modules" node_modules
export TMPDIR="$HOME/.cache/dash-spen-render-tmp"
mkdir -p "$TMPDIR"
trap 'cp -a .repair-receipts "$source_dir/"' EXIT
mkdir -p .repair-receipts
[ -L bridge/node_modules ] || ln -s "$cache/bridge/node_modules" bridge/node_modules
[ -e .git ] || git init -q
git add app bridge shared scripts
set +e
bun app/node_modules/typescript/bin/tsc -p app --noEmit > .repair-receipts/typecheck.log 2>&1
typecheck=$?
bun test app/src bridge/src shared > .repair-receipts/unit.log 2>&1
unit=$?
bun scripts/mutate.ts > .repair-receipts/mutation.log 2>&1
mutation=$?
node scripts/ink-render-proof.mjs 9>&-
render=$?
printf 'typecheck=%s unit=%s mutation=%s render=%s\n' "$typecheck" "$unit" "$mutation" "$render" > .repair-receipts/gates.exit
exit "$((typecheck || unit || mutation || render))"
