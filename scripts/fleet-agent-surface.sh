#!/usr/bin/env bash
# All compilation, tests and rendering stay on the admitted MBP worker.
set -euo pipefail
source_dir="$PWD"
build_dir="$HOME/.cache/dash-agent-surface-20261022"
mkdir -p "$build_dir"
exec 9>"$build_dir.lock"
flock -n 9 || exit 75
rsync -a --delete --exclude=node_modules/ --exclude=/.git --exclude=/.surface-receipts/ ./ "$build_dir/"
cd "$build_dir"
mkdir -p .surface-receipts
trap 'cp -a .surface-receipts "$source_dir/"' EXIT
exec > >(tee .surface-receipts/validation.log) 2>&1
printf 'host=%s\nrevision=%s\n' "$(hostname)" "${DASH_PROOF_REVISION:-uncommitted}"
mirror="$HOME/.cache/dash-native-notifications-share-build/.native-build-inputs/aodl.git"
if [ -d "$mirror" ]; then
  git --git-dir="$mirror" cat-file -e 7bbe46909b4e76557cd2d87c3f5be7b9f957eaec
  export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.file://$mirror.insteadOf" GIT_CONFIG_VALUE_0=ssh://git@github.com/kvnloo/aodl-views.git GIT_ALLOW_PROTOCOL=file:https:ssh
fi
if [ ! -d .git ]; then git init -q; fi
bun install --frozen-lockfile
(cd bridge && bun install --frozen-lockfile)
(cd app && bun install --frozen-lockfile)
git add .
if [ "${DASH_SURFACE_RENDER_ONLY:-0}" != 1 ]; then
printf '\n== typecheck ==\n'
bun run typecheck > .surface-receipts/typecheck.log 2>&1
printf '\n== surface safety tests ==\n'
bun test shared/agent-surface.test.ts bridge/src/agent-surface.test.ts app/src/agent-surface > .surface-receipts/safety.log 2>&1
if [ "${DASH_SURFACE_QUICK:-0}" = 1 ]; then exit 0; fi
printf '\n== full tests ==\n'
bun run test > .surface-receipts/unit.log 2>&1
printf '\n== mutation ==\n'
bun scripts/mutate.ts > .surface-receipts/mutation.log 2>&1
printf '\n== Android export ==\n'
(cd app && CI=1 bun x expo export --platform android --output-dir ../.surface-receipts/android-export) > .surface-receipts/android-export.log 2>&1
fi
printf '\n== actual Web UI + authenticated bridge ==\n'
node scripts/agent-surface-proof.mjs > .surface-receipts/rendered.log 2>&1
printf '\nPASS: agent surface validation\n'
