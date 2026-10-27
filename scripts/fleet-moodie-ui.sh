#!/usr/bin/env bash
set -euo pipefail
source_dir="$PWD"
build_dir="$HOME/.cache/dash-moodie-faces-proof"
mkdir -p "$build_dir"
exec 9>"$HOME/.cache/dash-moodie-faces-proof.lock"
flock -n 9 || exit 75
rsync -a --delete --exclude=node_modules/ --exclude=/.git --exclude=/.moodie-ui-receipts/ ./ "$build_dir/"
cd "$build_dir"
mkdir -p .moodie-ui-receipts
trap 'cp -a .moodie-ui-receipts "$source_dir/"' EXIT
mirror="$HOME/.cache/dash-native-notifications-share-build/.native-build-inputs/aodl.git"
if [ -d "$mirror" ]; then
  export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.file://$mirror.insteadOf" GIT_CONFIG_VALUE_0=ssh://git@github.com/kvnloo/aodl-views.git GIT_ALLOW_PROTOCOL=file:https:ssh
fi
git init -q
bun install --frozen-lockfile
(cd app && bun install --frozen-lockfile)
bun test app/src/lib/moodie.test.ts app/src/lib/tree.test.ts
bun app/node_modules/typescript/bin/tsc -p app --noEmit
(cd app && EXPO_PUBLIC_DEBUG=1 EXPO_PUBLIC_DEBUG_AUTONAV=0 bun x expo export --platform web)
node scripts/moodie-faces-proof.mjs
