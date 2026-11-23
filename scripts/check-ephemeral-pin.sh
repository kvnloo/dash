#!/usr/bin/env bash
# Prepare the immutable inputs once; the default check then needs no network.
#   bash scripts/check-ephemeral-pin.sh --prepare [kit-checkout-dir]
#   bash scripts/check-ephemeral-pin.sh [kit-checkout-dir]
#   bash scripts/check-ephemeral-pin.sh --freshness [upstream]
set -euo pipefail
cd "$(dirname "$0")/.."
rev=$(sed -n 's/^export const KIT_REV = "\([0-9a-f]\{40\}\)";$/\1/p' app/scripts/ephemeral-kit/build.mjs)
[ -n "$rev" ] || { echo "check-ephemeral-pin: no KIT_REV in app/scripts/ephemeral-kit/build.mjs" >&2; exit 1; }
upstream=https://github.com/kvnloo/ephemeral-ui.git
kit_default=${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ephemeral-ui-$rev

case ${1:-} in
  --prepare)
    kit=${2:-$kit_default}
    git init --quiet "$kit"
    git -C "$kit" fetch --quiet --no-tags --depth=1 "$upstream" "$rev"
    git -C "$kit" checkout --quiet --detach "$rev"
    (cd "$kit" && npm ci --no-audit --no-fund)
    ;;
  --freshness)
    rc=0
    if refs=$(git ls-remote --exit-code "${2:-$upstream}" refs/heads/main); then
      main=${refs%%$'\t'*}
      if [ "$rev" = "$main" ]; then
        message="ephemeral-ui pin is current: $rev"
      else
        message="pinned $rev, kvnloo/ephemeral-ui main is $main: re-pin and rebuild"
        rc=1
      fi
    else
      message="Could not read ephemeral-ui main to compare with pin $rev"
      rc=1
    fi
    printf '%s\n' "$message"
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '### Ephemeral UI freshness\n\n%s\n' "$message" >> "$GITHUB_STEP_SUMMARY"; fi
    exit "$rc"
    ;;
  --*|-*) echo "Unknown option: $1" >&2; exit 2 ;;
  *)
    kit=${1:-$kit_default}
    node app/scripts/ephemeral-kit/build.mjs --kit "$kit" --check
    node scripts/check-shared-ephemeral.mjs --kit "$kit" "$rev"
    ;;
esac
