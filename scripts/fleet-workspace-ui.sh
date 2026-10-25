#!/usr/bin/env bash
set -euo pipefail
source_dir="$PWD"
build_dir="$HOME/.cache/dash-workspace-navigation-proof"
mkdir -p "$build_dir"
exec 9>"$HOME/.cache/dash-workspace-navigation-proof.lock"
flock -n 9 || exit 75
rsync -a --delete --exclude=node_modules/ --exclude=/.git --exclude=/.workspace-ui-receipts/ ./ "$build_dir/"
cd "$build_dir"
mkdir -p .workspace-ui-receipts
trap 'cp -a .workspace-ui-receipts "$source_dir/"' EXIT
mirror="$HOME/.cache/dash-native-notifications-share-build/.native-build-inputs/aodl.git"
if [ -d "$mirror" ]; then
  export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.file://$mirror.insteadOf" GIT_CONFIG_VALUE_0=ssh://git@github.com/kvnloo/aodl-views.git GIT_ALLOW_PROTOCOL=file:https:ssh
fi
bun install --frozen-lockfile
(cd app && bun install --frozen-lockfile)
node scripts/workspace-navigation-proof.mjs
