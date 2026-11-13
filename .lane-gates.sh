#!/bin/bash
# Lane gates on an MBP fleet job (run from the composed worktree via fleet-build).
# Same dependency path as dash-turbo/fleet-gates.sh, own cache, receipts in .lane-receipts/.
set -euo pipefail
src="$PWD"
cache="$HOME/.cache/dash-lane-qualified-20261025"
mkdir -p "$cache"
exec 9>"$cache.lock"; flock 9
rsync -a --delete --exclude=node_modules --exclude=/.git --exclude=/.lane-receipts ./ "$cache/"
cd "$cache"
rm -rf .lane-receipts; mkdir -p .lane-receipts
printf '%s\n' "${DASH_PROOF_REVISION:?exact candidate revision required}" > .lane-receipts/input-sha.txt
trap 'cp -a .lane-receipts "$src/"' EXIT
mirror="$HOME/.cache/dash-native-notifications-share-build/.native-build-inputs/aodl.git"
if [ -d "$mirror" ]; then
 export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.file://$mirror.insteadOf" GIT_CONFIG_VALUE_0=ssh://git@github.com/kvnloo/aodl-views.git GIT_ALLOW_PROTOCOL=file:https:ssh
fi
[ -d .git ] || git init -q
bun install --frozen-lockfile >.lane-receipts/deps.log 2>&1
(cd app && bun install --frozen-lockfile) >>.lane-receipts/deps.log 2>&1
(cd bridge && bun install --frozen-lockfile) >>.lane-receipts/deps.log 2>&1
git add -A app/src bridge/src shared scripts >/dev/null 2>&1 || true
set +e
bun test app/src bridge/src shared > .lane-receipts/unit.log 2>&1; unit=$?
bun run typecheck > .lane-receipts/typecheck.log 2>&1; types=$?
bun run lint > .lane-receipts/lint.log 2>&1; lint=$?
if [ "${LANE_MUTATION:-1}" = 1 ]; then bun scripts/mutate.ts > .lane-receipts/mutation.log 2>&1; mutation=$?; else mutation=skipped; fi
set -e
printf 'unit=%s\ntypecheck=%s\nlint=%s\nmutation=%s\n' "$unit" "$types" "$lint" "$mutation" | tee .lane-receipts/status.txt
# Red stage must fail the job (bug 2026-11-05: gates_exit=0 with unit=1 let army run).
[ "$unit" = 0 ] && [ "$types" = 0 ] && [ "$lint" = 0 ] && { [ "$mutation" = 0 ] || [ "$mutation" = skipped ]; }
