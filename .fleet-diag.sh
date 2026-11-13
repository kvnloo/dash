#!/bin/bash
set -euo pipefail
src="$PWD"
cache="$HOME/.cache/dash-turbo-qualified-20261025"
mkdir -p "$cache"
exec 9>"$cache.lock"
flock 9
rsync -a --delete --exclude=node_modules --exclude=/.git --exclude=/.turbo-receipts ./ "$cache/"
cd "$cache"
if [ -d .turbo-receipts ]; then mv .turbo-receipts ".turbo-receipts-prev-$(date +%s%N)"; fi
mkdir -p .turbo-receipts
printf '%s\n' "${DASH_PROOF_REVISION:?exact candidate revision required}" > .turbo-receipts/input-sha.txt
sha256sum app/src/store/app.ts app/src/store/text.ts app/package.json app/bun.lock > .turbo-receipts/source.sha256
trap 'cp -a .turbo-receipts "$src/"' EXIT
mirror="$HOME/.cache/dash-native-notifications-share-build/.native-build-inputs/aodl.git"
if [ -d "$mirror" ]; then
 export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.file://$mirror.insteadOf" GIT_CONFIG_VALUE_0=ssh://git@github.com/kvnloo/aodl-views.git GIT_ALLOW_PROTOCOL=file:https:ssh
fi
[ ! -L app/node_modules ] || unlink app/node_modules
[ -d .git ] || git init -q
bun install --frozen-lockfile >.turbo-receipts/deps.log 2>&1
(cd app && bun install --frozen-lockfile) >>.turbo-receipts/deps.log 2>&1
(cd bridge && bun install --frozen-lockfile) >>.turbo-receipts/deps.log 2>&1
git add app/src bridge/src shared scripts
# Separate logs avoid a later command replacing an earlier gate.
set +e
unit=0; : > .turbo-receipts/unit-files.tsv; mkdir -p .turbo-receipts/unit
for f in $(git ls-files 'app/src/*.test.ts' 'app/src/*.test.tsx' 'bridge/src/*.test.ts' 'shared/*.test.ts' scripts/mutate.test.ts scripts/assert-nav-dots.test.ts scripts/oss-loop.test.ts scripts/phone-install.test.ts scripts/keep-going.test.ts | sort); do
  lf=".turbo-receipts/unit/$(printf %s "$f" | tr / _).log"
  timeout -k 5 90 bun test "./$f" > "$lf" 2>&1; rc=$?
  printf '%s\t%s\n' "$rc" "$f" >> .turbo-receipts/unit-files.tsv
  [ "$rc" = 0 ] || unit=1
done
bun run typecheck > .turbo-receipts/typecheck.log 2>&1; types=$?
bun run lint > .turbo-receipts/lint.log 2>&1; lint=$?
timeout -k 5 900 bun scripts/mutate.ts > .turbo-receipts/mutation.log 2>&1; mutation=$?
(cd app && CI=1 bun x expo export --platform android --output-dir ../.turbo-receipts/android-export) > .turbo-receipts/android-export.log 2>&1; android=$?
set -e
printf "lint=$lint\n" >> .turbo-receipts/status.txt; printf 'unit=%s\ntypecheck=%s\nmutation=%s\nandroid_export=%s\n' "$unit" "$types" "$mutation" "$android" | tee -a .turbo-receipts/status.txt
[ "$unit" = 0 ] && [ "$types" = 0 ] && [ "$mutation" = 0 ] && [ "$android" = 0 ]
