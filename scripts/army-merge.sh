#!/usr/bin/env bash
# Merge sharded tester-army runs (ARMY_SHARD=i/N scripts/army.sh) into one O15 receipt.
#
#   scripts/army-merge.sh <blob-dir> [--started ISO8601]
#
# <blob-dir> holds every shard's report-<i>.zip. Playwright merge-reports rebuilds the
# one results.json (and html report) through the army's own playwright.config.ts
# reporters, then the unchanged e2e/mbp-army/receipt.py writes the receipt for HEAD
# under artifacts/army/<sha>/receipt and $DASH_ARMY_RECEIPTS/<sha>. A missing shard
# leaves its tests out of results.json, so coverage is incomplete and O15 denies.
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD
blobs=$(cd "${1:?usage: scripts/army-merge.sh <blob-dir> [--started ISO8601]}" && pwd)
shift
sha=$(git rev-parse HEAD)
out=${ARMY_OUT:-$root/artifacts/army/$sha}
mkdir -p "$out"
rm -rf "$out/html" "$out/results.json"
ls "$blobs"/report-*.zip >/dev/null || { echo "army-merge: no shard blob reports in $blobs" >&2; exit 1; }
echo "army-merge: $(ls "$blobs"/report-*.zip | wc -l) shard report(s) for $sha"
export ARMY_HTML=$out/html ARMY_JSON=$out/results.json
unset ARMY_STARTUP
set +e
node node_modules/playwright/cli.js merge-reports -c e2e/mbp-army/playwright.config.ts "$blobs" >"$out/merge.log" 2>&1
pw=$?
set -e
tail -5 "$out/merge.log"
[ -f "$out/results.json" ] || { echo "army-merge: merge-reports wrote no results.json (exit $pw)" >&2; exit 1; }
rc=0
python3 e2e/mbp-army/receipt.py "$out/results.json" "$out" "$@" || rc=$?
exit $(( pw != 0 ? pw : rc ))
