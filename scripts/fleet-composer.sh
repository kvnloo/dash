#!/usr/bin/env bash
# Offloaded composer-lane validation. DASH_GATES selects: quick (typecheck, lint, tests),
# full (quick + mutation + Android export + rendered proof) or render (rendered proof only).
set -euo pipefail
source_dir="$PWD"
build_dir="$HOME/.cache/dash-program-composer"
mkdir -p "$build_dir"
exec 9>"$HOME/.cache/dash-program-composer.lock"
flock -n 9 || exit 75
rsync -a --delete --exclude=node_modules/ --exclude=/.git --exclude=/.composer-receipts/ ./ "$build_dir/"
cd "$build_dir"
if [ -d .composer-receipts ]; then rm -r .composer-receipts; fi
mkdir -p .composer-receipts
trap 'cp -a .composer-receipts "$source_dir/"' EXIT
exec > >(tee .composer-receipts/validation.log) 2>&1
gates="${DASH_GATES:-quick}"
printf 'host=%s\nrevision=%s\ngates=%s\n' "$(hostname)" "${DASH_PROOF_REVISION:-uncommitted}" "$gates"
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
status=0
run() { local name="$1"; shift; printf '\n== %s ==\n' "$name"; if "$@" > ".composer-receipts/$name.log" 2>&1; then echo "PASS $name"; else echo "FAIL $name"; status=1; fi; tail -5 ".composer-receipts/$name.log"; }
if [ "$gates" != render ]; then
  run typecheck bun run typecheck
  run lint bun run lint
  run unit bun run test
fi
if [ "$gates" = full ]; then
  run mutation bun scripts/mutate.ts
  run android-export sh -c 'cd app && CI=1 bun x expo export --platform android --output-dir ../.composer-receipts/android-export'
fi
if [ "$gates" = full ] || [ "$gates" = render ]; then
  run rendered node scripts/composer-controls-proof.mjs
  run keyboard-regression sh -c 'node scripts/keyboard-attach-proof.mjs && cp -a .keyboard-receipts .composer-receipts/keyboard-attach'
fi
exit "$status"
