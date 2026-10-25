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
node scripts/ink-render-proof.mjs 9>&-
