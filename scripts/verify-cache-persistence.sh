#!/bin/bash
set -euo pipefail
src="$PWD"
cache="$HOME/.cache/dash-cache-persistence"
mkdir -p "$cache"
exec 9>"$cache.lock"
flock 9
rsync -a --delete --exclude=node_modules --exclude=/.git --exclude=/.cache-receipts ./ "$cache/"
cd "$cache"
mkdir -p .cache-receipts
trap 'cp -a .cache-receipts "$src/"' EXIT
mirror="$HOME/.cache/dash-native-notifications-share-build/.native-build-inputs/aodl.git"
if [ -d "$mirror" ]; then
 export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.file://$mirror.insteadOf" GIT_CONFIG_VALUE_0=ssh://git@github.com/kvnloo/aodl-views.git GIT_ALLOW_PROTOCOL=file:https:ssh
fi
[ ! -L app/node_modules ] || unlink app/node_modules
[ -d .git ] || git init -q
bun install --frozen-lockfile > .cache-receipts/deps.log 2>&1
(cd app && bun install --frozen-lockfile) >> .cache-receipts/deps.log 2>&1
(cd bridge && bun install --frozen-lockfile) >> .cache-receipts/deps.log 2>&1
git add app/src bridge/src shared scripts
set +e
bun test app/src/store/conversation-persistence.test.ts app/src/store/app.test.ts > .cache-receipts/focused.log 2>&1; focused=$?
bun run typecheck > .cache-receipts/typecheck.log 2>&1; types=$?
bun run lint > .cache-receipts/lint.log 2>&1; lint=$?
bun run test > .cache-receipts/unit.log 2>&1; unit=$?
bun scripts/mutate.ts > .cache-receipts/mutation.log 2>&1; mutation=$?
bun scripts/benchmark-conversation-persistence.ts > .cache-receipts/benchmark.json 2>&1; bench=$?
sha256sum app/src/store/conversation* app/src/store/app.ts > .cache-receipts/source-sha256.txt
(cd app && CI=1 bun x expo export --platform android --output-dir ../.cache-receipts/android-export) > .cache-receipts/android-export.log 2>&1; android=$?
printf 'focused=%s\ntypes=%s\nlint=%s\nunit=%s\nmutation=%s\nbenchmark=%s\nandroid=%s\n' "$focused" "$types" "$lint" "$unit" "$mutation" "$bench" "$android" > .cache-receipts/status.txt
cat .cache-receipts/status.txt
[ "$focused" = 0 ] && [ "$types" = 0 ] && [ "$unit" = 0 ] && [ "$mutation" = 0 ] && [ "$android" = 0 ]
