#!/usr/bin/env bash
# Admitted MBP only; private cache, never any served source or phone.
set -euo pipefail
source_dir="$PWD"
build_dir="$HOME/.cache/dash-interaction-repair-20261022-${DASH_REPAIR_GATE:-render}"
mkdir -p "$build_dir"
exec 9>"$build_dir.lock"
flock -n 9 || exit 75
rsync -a --delete --exclude=node_modules/ --exclude=/.git --exclude=/.repair-receipts/ --exclude=/app/android/ ./ "$build_dir/"
cd "$build_dir"
mkdir -p .repair-receipts
trap 'cp -a .repair-receipts "$source_dir/"' EXIT
exec > >(tee .repair-receipts/validation.log) 2>&1
printf 'host=%s\nrevision=%s\n' "$(hostname)" "${DASH_PROOF_REVISION:-uncommitted}"
mirror="$HOME/.cache/dash-native-notifications-share-build/.native-build-inputs/aodl.git"
if [ -d "$mirror" ]; then
  export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.file://$mirror.insteadOf" GIT_CONFIG_VALUE_0=ssh://git@github.com/kvnloo/aodl-views.git GIT_ALLOW_PROTOCOL=file:https:ssh
fi
[ -d .git ] || git init -q
bun install --frozen-lockfile
(cd app && bun install --frozen-lockfile)
(cd bridge && bun install --frozen-lockfile)
case "${DASH_REPAIR_GATE:-render}" in
  render) node scripts/ink-render-proof.mjs ;;
  unit) bun test app/src/lib/annotate app/src/store/annotate.test.ts app/src/lib/identity-client.test.ts app/src/lib/continuous-voice.test.ts app/src/lib/voice-launch.test.ts app/src/lib/recorded-speech.test.ts ;;
  full)
    bun run typecheck > .repair-receipts/typecheck.log 2>&1
    bun run test > .repair-receipts/unit.log 2>&1
    bun scripts/mutate.ts > .repair-receipts/mutation.log 2>&1
    bun run lint > .repair-receipts/lint.log 2>&1
    (cd app && CI=1 bun x expo export --platform android --output-dir ../.repair-receipts/android-export) > .repair-receipts/android-export.log 2>&1
    node scripts/ink-render-proof.mjs ;;
esac
