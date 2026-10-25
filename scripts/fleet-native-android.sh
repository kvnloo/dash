#!/usr/bin/env bash
set -euo pipefail
source_dir="$PWD"
build_dir="$HOME/.cache/dash-spen-voice-native-20261025"
mkdir -p "$build_dir"
exec 9>"$build_dir.lock"
flock -n 9 || { printf 'This native build workspace is already in use.\n' >&2; exit 75; }
rsync -a --delete --exclude=/app/android/ --exclude=node_modules --exclude=/.git --exclude=/.native-receipts/ --exclude=/.native-build-inputs/aodl.git/ ./ "$build_dir/"
cd "$build_dir"
if [ -d .native-receipts ]; then rm -r .native-receipts; fi
if [ ! -f app/android/app/debug.keystore ] && [ -f "$HOME/.cache/dash-interaction-repair-native-20261022/app/android/app/debug.keystore" ]; then
  mkdir -p app/android/app
  cp "$HOME/.cache/dash-interaction-repair-native-20261022/app/android/app/debug.keystore" app/android/app/debug.keystore
fi
set +e
bash scripts/build-native-android.sh
status=$?
set -e
if [ -d .native-receipts ]; then cp -a .native-receipts "$source_dir/"; fi
exit "$status"
