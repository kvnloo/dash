#!/usr/bin/env bash
# Fails when Dash's vendored kvnloo/ephemeral-ui kit or shared card catalog (app/src/vendor/ephemeral-ui/) is
# stale: behind the kit's main, regenerated differently from the pinned revision, or missing a catalog kind.
#   bash scripts/check-ephemeral-pin.sh [kit-checkout-dir]
set -euo pipefail
cd "$(dirname "$0")/.."
rev=$(sed -n 's/^export const KIT_REV = "\([0-9a-f]\{40\}\)";$/\1/p' app/scripts/ephemeral-kit/build.mjs)
[ -n "$rev" ] || { echo "check-ephemeral-pin: no KIT_REV in app/scripts/ephemeral-kit/build.mjs" >&2; exit 1; }
kit=${1:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ephemeral-ui}
[ -d "$kit/.git" ] || git clone --quiet https://github.com/kvnloo/ephemeral-ui.git "$kit"
git -C "$kit" fetch --quiet origin main
git -C "$kit" -c advice.detachedHead=false checkout --quiet "$rev"
(cd "$kit" && npm ci --silent --no-audit --no-fund)
node app/scripts/ephemeral-kit/build.mjs --kit "$kit" --check --main
