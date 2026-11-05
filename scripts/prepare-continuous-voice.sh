#!/usr/bin/env bash
set -euo pipefail
source_dir="$PWD"
build_dir="$HOME/.cache/dash-native-continuous-voice-build"
mkdir -p "$build_dir"
exec 9>"$HOME/.cache/dash-native-continuous-voice-build.lock"
flock -n 9 || exit 75
rsync -a --delete --exclude=/app/android/ --exclude=node_modules/ --exclude=/.git --exclude=/.voice-deps/ ./ "$build_dir/"
cd "$build_dir"
mkdir -p .voice-deps
exec > >(tee .voice-deps/prepare.log) 2>&1
# Reuse only the pinned public source mirror, never another job's dependencies.
mirror="$HOME/.cache/dash-native-notifications-share-build/.native-build-inputs/aodl.git"
if [ -d "$mirror" ]; then
 export GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0="url.file://$mirror.insteadOf" GIT_CONFIG_VALUE_0=ssh://git@github.com/kvnloo/aodl-views.git
 export GIT_CONFIG_KEY_1="url.file://$mirror.insteadOf" GIT_CONFIG_VALUE_1=https://github.com/kvnloo/aodl-views.git GIT_ALLOW_PROTOCOL=file:https:ssh
fi
bun install --frozen-lockfile
cd app
bun install --frozen-lockfile
CI=1 bun x expo install react-native-webrtc
cp package.json bun.lock ../.voice-deps/
node -e 'const p=require("react-native-webrtc/package.json"); console.log(JSON.stringify({version:p.version,peerDependencies:p.peerDependencies}))' > ../.voice-deps/webrtc-version.json
cp -r node_modules/react-native-webrtc/lib/typescript ../.voice-deps/webrtc-types
cd ..
cp -a .voice-deps "$source_dir/"
