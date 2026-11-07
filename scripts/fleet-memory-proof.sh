#!/usr/bin/env bash
# Isolated MBP qualification. No live services, phone or APK changes.
set -euo pipefail
source_dir="$PWD"
build_dir="${MEMORY_BUILD_CACHE:-$HOME/.cache/dash-memory-proof-20261025}"
mkdir -p "$build_dir"
exec 9>"$build_dir.lock"
flock -n 9 || exit 75
rsync -a --delete --exclude=node_modules --exclude=/.git --exclude=/.memory-receipts/ ./ "$build_dir/"
cd "$build_dir"
mkdir -p .memory-receipts
trap 'cp -a .memory-receipts "$source_dir/"' EXIT
mirror="$HOME/.cache/dash-native-notifications-share-build/.native-build-inputs/aodl.git"
if [ -d "$mirror" ]; then
 export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.file://$mirror.insteadOf" GIT_CONFIG_VALUE_0=ssh://git@github.com/kvnloo/aodl-views.git GIT_ALLOW_PROTOCOL=file:https:ssh
fi
# An absolute host dependency symlink is not portable into the admitted worker.
[ ! -L app/node_modules ] || unlink app/node_modules
[ -d .git ] || git init -q
bun install --frozen-lockfile > .memory-receipts/deps.log 2>&1
(cd app && bun install --frozen-lockfile) >> .memory-receipts/deps.log 2>&1
(cd bridge && bun install --frozen-lockfile) >> .memory-receipts/deps.log 2>&1
git add app/src bridge/src shared scripts
sha256sum app/src/store/app.ts app/src/store/text.ts app/src/components/BotFace.tsx > .memory-receipts/source-after.sha256
if [ "${MEMORY_PHASE:-all}" != after ]; then
cp app/src/store/app.ts .memory-receipts/app-fixed.ts
cp app/src/components/BotFace.tsx .memory-receipts/BotFace-fixed.tsx
cp .memory-inputs/app-before.ts app/src/store/app.ts
cp .memory-inputs/BotFace-before.tsx app/src/components/BotFace.tsx
sha256sum app/src/store/app.ts app/src/store/text.ts app/src/components/BotFace.tsx > .memory-receipts/source-before.sha256
set +e
bun test app/src/store/reply-lifetime.test.ts > .memory-receipts/regression-before.log 2>&1
red=$?
set -e
printf '%s\n' "$red" > .memory-receipts/regression-before.exit
[ "$red" != 0 ] || { printf 'Baseline unexpectedly passed retention regression\n'; exit 1; }
bun scripts/build-retention-probe.ts
MEMORY_LABEL=before node scripts/reply-retention-proof.mjs > .memory-receipts/browser-before.log 2>&1
(cd app && EXPO_PUBLIC_DEBUG=1 EXPO_PUBLIC_DEBUG_AUTONAV=0 bun x expo export --platform web --output-dir dist) > .memory-receipts/export-before.log 2>&1
set +e
node scripts/moodie-faces-proof.mjs > .memory-receipts/face-before.log 2>&1
face_red=$?
set -e
printf '%s\n' "$face_red" > .memory-receipts/face-before.exit
[ "$face_red" != 0 ] || { printf 'Baseline unexpectedly passed native view eye contract\n'; exit 1; }
python3 -c 'from pathlib import Path; assert "Moodie gaze must use its own rendered View layer" in Path(".memory-receipts/face-before.log").read_text()'
cp .memory-receipts/app-fixed.ts app/src/store/app.ts
cp .memory-receipts/BotFace-fixed.tsx app/src/components/BotFace.tsx
fi
: > .memory-receipts/status.txt
fail=0
stage() {
 local name="$1"; shift
 set +e
 "$@" > ".memory-receipts/$name.log" 2>&1
 local code=$?
 set -e
 printf '%s=%s\n' "$name" "$code" | tee -a .memory-receipts/status.txt
 [ "$code" = 0 ] || fail=1
}
stage regression-after bun test app/src/store/reply-lifetime.test.ts app/src/store/app.test.ts
stage typecheck bun app/node_modules/typescript/bin/tsc -p app --noEmit
stage unit bun test app/src bridge/src shared
stage mutation bun scripts/mutate.ts
bun scripts/build-retention-probe.ts
stage browser-after env MEMORY_LABEL=after node scripts/reply-retention-proof.mjs
[ "${MEMORY_GATES:-all}" != store ] || exit "$fail"
stage web-export-after bash -c 'cd app && EXPO_PUBLIC_DEBUG=1 EXPO_PUBLIC_DEBUG_AUTONAV=0 bun x expo export --platform web --output-dir dist'
stage faces-after node scripts/moodie-faces-proof.mjs
cp -a .moodie-ui-receipts .memory-receipts/faces
exit "$fail"
