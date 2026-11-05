#!/usr/bin/env bash
# Offloaded-only validation. Never serves or modifies a local Metro worktree.
set -euo pipefail
source_dir="$PWD"
build_dir="$HOME/.cache/dash-keyboard-attach-fix"
mkdir -p "$build_dir"
exec 9>"$HOME/.cache/dash-keyboard-attach-fix.lock"
flock -n 9 || exit 75
rsync -a --delete --exclude=node_modules/ --exclude=/.git --exclude=/.keyboard-receipts/ ./ "$build_dir/"
cd "$build_dir"
if [ -d .keyboard-receipts ]; then rm -r .keyboard-receipts; fi
mkdir -p .keyboard-receipts
trap 'cp -a .keyboard-receipts "$source_dir/"' EXIT
exec > >(tee .keyboard-receipts/validation.log) 2>&1
printf 'host=%s\nrevision=%s\n' "$(hostname)" "${DASH_PROOF_REVISION:-uncommitted}"
# Reuse only the already-pinned Git object, never another worker's build workspace.
mirror="$HOME/.cache/dash-native-notifications-share-build/.native-build-inputs/aodl.git"
if [ -d "$mirror" ]; then
  git --git-dir="$mirror" cat-file -e 7bbe46909b4e76557cd2d87c3f5be7b9f957eaec
  export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.file://$mirror.insteadOf" GIT_CONFIG_VALUE_0=ssh://git@github.com/kvnloo/aodl-views.git GIT_ALLOW_PROTOCOL=file:https:ssh
fi
if [ ! -d .git ]; then git init -q; fi
bun install --frozen-lockfile
(cd bridge && bun install --frozen-lockfile)
(cd app && bun install --frozen-lockfile)
# Real-workspace inventory tests need a Git inventory in fleet's source snapshot.
git add .
if [ "${DASH_RENDER_ONLY:-0}" != 1 ]; then
  printf '\n== typecheck ==\n'
  bun run typecheck > .keyboard-receipts/typecheck.log 2>&1
  printf '\n== full tests ==\n'
  bun run test > .keyboard-receipts/unit.log 2>&1
  printf '\n== mutation ==\n'
  bun scripts/mutate.ts > .keyboard-receipts/mutation.log 2>&1
  printf '\n== Android export ==\n'
  (cd app && CI=1 bun x expo export --platform android --output-dir ../.keyboard-receipts/android-export) > .keyboard-receipts/android-export.log 2>&1
fi
printf '\n== rendered before/after regressions ==\n'
node scripts/keyboard-attach-proof.mjs > .keyboard-receipts/rendered.log 2>&1
printf '\nPASS: keyboard + attachment validation\n'
