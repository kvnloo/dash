#!/usr/bin/env bash
set -euo pipefail
source_dir="$PWD"
cache="$HOME/.cache/dash-parent-omp-ui-20261022"
mkdir -p "$cache"
exec 9>"$HOME/.cache/dash-parent-omp-ui-20261022.lock"
flock -n 9 || exit 75
rsync -a --delete --exclude=node_modules/ --exclude=/.git --exclude=/.omp-ui-receipts/ ./ "$cache/"
cd "$cache"
mkdir -p .omp-ui-receipts
finish() {
  rc=$?
  printf 'runner_exit=%s\n' "$rc" >> .omp-ui-receipts/validation.log
  for name in .moodie-ui-receipts .chat-rows-receipts; do
    if [ -d "$name" ]; then cp -a "$name" .omp-ui-receipts/; fi
  done
  cp -a .omp-ui-receipts "$source_dir/"
}
trap finish EXIT
printf 'host=%s\nrevision=%s\n' "$(hostname)" "${DASH_PROOF_REVISION:?exact candidate SHA required}" | tee .omp-ui-receipts/validation.log
printf '%s\n' "$DASH_PROOF_REVISION" > .omp-ui-receipts/source-revision.txt
mirror="$HOME/.cache/dash-native-notifications-share-build/.native-build-inputs/aodl.git"
if [ -d "$mirror" ]; then
  export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.file://$mirror.insteadOf" GIT_CONFIG_VALUE_0=ssh://git@github.com/kvnloo/aodl-views.git GIT_ALLOW_PROTOCOL=file:https:ssh
fi
git init -q
bun install --frozen-lockfile > .omp-ui-receipts/deps.log 2>&1
(cd app && bun install --frozen-lockfile) >> .omp-ui-receipts/deps.log 2>&1
(cd bridge && bun install --frozen-lockfile) >> .omp-ui-receipts/deps.log 2>&1
git add .
run_stage() {
  label="$1"; shift
  printf '\n== %s ==\n' "$label" | tee -a .omp-ui-receipts/validation.log
  set +e
  "$@" > ".omp-ui-receipts/$label.log" 2>&1
  rc=$?
  set -e
  printf '%s exit=%s\n' "$label" "$rc" | tee -a .omp-ui-receipts/validation.log
  [ "$rc" -eq 0 ] || exit "$rc"
}
run_stage typecheck bun run typecheck
run_stage unit bun run test
run_stage mutation bun run test:mutate
run_stage android-export bash -c 'cd app && bun x expo export --platform android --output-dir ../.omp-ui-receipts/android-export'
run_stage web-export bash -c 'cd app && EXPO_PUBLIC_DEBUG=1 EXPO_PUBLIC_DEBUG_AUTONAV=0 bun x expo export --platform web'
run_stage moodie-render node scripts/moodie-faces-proof.mjs
run_stage chat-rows-render flock "$HOME/.cache/dash-expo-proof-8099.lock" node scripts/chat-rows-proof.mjs
printf 'PASS: combined D51+D10 source gates; NOT native phone or final chat-window/ink composition acceptance\nRepo-wide lint not run: known e29dd36 VoiceScreen suppression baseline; final composition must close it.\n' | tee -a .omp-ui-receipts/validation.log
