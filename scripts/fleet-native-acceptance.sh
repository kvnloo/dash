#!/usr/bin/env bash
# Native acceptance candidate gates (repair + chat-window + OMP UI + scoped bridge fixes).
# Admitted MBP only via fleet-build; private cache; never a served tree, phone, bridge or Metro.
# Every stage runs and records its exit code so one admitted job returns all receipts.
set -uo pipefail
source_dir="$PWD"
build_dir="$HOME/.cache/dash-native-acceptance-20261022"
mkdir -p "$build_dir"
exec 9>"$build_dir.lock"
flock -n 9 || exit 75
rsync -a --delete --exclude=node_modules --exclude=/.git --exclude=/.acceptance-receipts/ --exclude=/app/android/ ./ "$build_dir/"
cd "$build_dir"
rm -rf .acceptance-receipts .chat-window-receipts .repair-receipts .moodie-ui-receipts .chat-rows-receipts
mkdir -p .acceptance-receipts
finish() {
  for name in .chat-window-receipts .repair-receipts .moodie-ui-receipts .chat-rows-receipts; do
    [ -d "$name" ] && cp -a "$name" .acceptance-receipts/
  done
  cp -a .acceptance-receipts "$source_dir/"
}
trap finish EXIT
exec > >(tee .acceptance-receipts/validation.log 9>&-) 2>&1
printf 'host=%s\nrevision=%s\nstages=%s\n' "$(hostname)" "${DASH_PROOF_REVISION:?exact candidate SHA required}" "${NA_STAGES:-all}"
printf '%s\n' "$DASH_PROOF_REVISION" > .acceptance-receipts/source-revision.txt
mirror="$HOME/.cache/dash-native-notifications-share-build/.native-build-inputs/aodl.git"
if [ -d "$mirror" ]; then
  export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.file://$mirror.insteadOf" GIT_CONFIG_VALUE_0=ssh://git@github.com/kvnloo/aodl-views.git GIT_ALLOW_PROTOCOL=file:https:ssh
fi
[ -d .git ] || git init -q
set -e
bun install --frozen-lockfile > .acceptance-receipts/deps.log 2>&1
(cd bridge && bun install --frozen-lockfile) >> .acceptance-receipts/deps.log 2>&1
(cd app && bun install --frozen-lockfile) >> .acceptance-receipts/deps.log 2>&1
git add .
set +e
fail=0
stage() {
  local name="$1"; shift
  printf '\n== %s ==\n' "$name"
  "$@" 9>&- > ".acceptance-receipts/$name.log" 2>&1
  local code=$?
  printf '%s exit=%s\n' "$name" "$code"
  [ "$code" = 0 ] || fail=1
}
want() { [ "${NA_STAGES:-all}" = all ] || [[ ",${NA_STAGES}," == *",$1,"* ]]; }
want typecheck && stage typecheck bun run typecheck
want lint && stage lint bun run lint
want unit && stage unit bun run test
# Hermes native-source Python tests (context_snapshot_test.py, hermes-live native views) need a full Hermes venv
# (ruamel, pm, ...) that MBP lacks; run the source-independent hermes-live tests only and report the gap.
want unit && stage bridge-python-live env -u DASH_HERMES_SOURCE python3 bridge/src/hermes-live.test.py
want mutation && stage mutation bun run test:mutate
want export && stage android-export bash -c 'cd app && CI=1 bun x expo export --platform android --output-dir ../.acceptance-receipts/android-export'
want render && stage web-export bash -c 'cd app && EXPO_PUBLIC_DEBUG=1 EXPO_PUBLIC_DEBUG_AUTONAV=0 bun x expo export --platform web'
want render && stage chat-window-render node scripts/chat-window-proof.mjs
{ want render || want ink; } && stage ink-voice-render node scripts/ink-render-proof.mjs
want render && stage moodie-render node scripts/moodie-faces-proof.mjs
want render && stage chat-rows-render flock "$HOME/.cache/dash-expo-proof-8099.lock" node scripts/chat-rows-proof.mjs
printf '\nRESULT: %s (web/source gates only; not APK, phone, S25 or duplex media acceptance)\n' "$([ $fail = 0 ] && echo PASS || echo FAIL)"
exit $fail
