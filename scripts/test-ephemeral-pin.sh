#!/usr/bin/env bash
# Regression for the CI check, not a Dash UI test. Uses the already prepared pinned checkout.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git init --quiet --initial-branch=main "$tmp/upstream"
git -C "$tmp/upstream" -c user.name=Fixture -c user.email= commit --quiet --allow-empty -m 'Upstream moved'
upstream_rev=$(git -C "$tmp/upstream" rev-parse HEAD)

# Run the same check as PRs, then check the schedule against a deterministically different main.
GIT_ALLOW_PROTOCOL=file npm_config_offline=true \
  GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.$tmp/upstream.insteadOf" \
  GIT_CONFIG_VALUE_0=https://github.com/kvnloo/ephemeral-ui.git \
  bash scripts/check-ephemeral-pin.sh "$@"
rc=0
GITHUB_STEP_SUMMARY="$tmp/summary" bash scripts/check-ephemeral-pin.sh --freshness "$tmp/upstream" || rc=$?
test "$rc" -eq 1
grep -F "main is $upstream_rev: re-pin and rebuild" "$tmp/summary"
echo "PASS: a stale upstream does not fail vendored integrity, but fails freshness with drift in the summary"
