#!/usr/bin/env bash
# Chat-window native APK on MBP. Own build workspace and lock: never reuses the shared
# notifications/share or interaction-repair native build directories.
set -euo pipefail
source_dir="$PWD"
build_dir="$HOME/.cache/dash-chat-window-native-20261022"
mkdir -p "$build_dir"
exec 9>"$build_dir.lock"
flock -n 9 || { printf 'chat-window native workspace busy\n' >&2; exit 75; }
rsync -a --delete --exclude=/app/android/ --exclude=node_modules/ --exclude=/.git --exclude=/.native-receipts/ ./ "$build_dir/"
cd "$build_dir"
rm -rf .native-receipts
# Read-only use of the already-pinned aodl Git object mirror (no credentials copied).
mirror="$HOME/.cache/dash-native-notifications-share-build/.native-build-inputs/aodl.git"
if [ -d "$mirror" ]; then
  export GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0="url.file://$mirror.insteadOf" GIT_CONFIG_VALUE_0=ssh://git@github.com/kvnloo/aodl-views.git
  export GIT_CONFIG_KEY_1="url.file://$mirror.insteadOf" GIT_CONFIG_VALUE_1=https://github.com/kvnloo/aodl-views.git GIT_ALLOW_PROTOCOL=file:https:ssh
fi
set +e
bash scripts/build-native-android.sh
status=$?
set -e
printf 'revision=%s\nstatus=%s\n' "${DASH_PROOF_REVISION:-uncommitted}" "$status" >> .native-receipts/build.log
if [ -d .native-receipts ]; then cp -a .native-receipts "$source_dir/"; fi
exit "$status"
