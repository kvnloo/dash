#!/usr/bin/env bash
# Offloaded-only validation for the chat window slice. Never serves or modifies a local Metro worktree.
# Every stage runs and records its exit code, so one admitted MBP job returns all receipts.
set -uo pipefail
source_dir="$PWD"
build_dir="$HOME/.cache/dash-chat-window-20261022"
mkdir -p "$build_dir"
exec 9>"$build_dir.lock"
flock -n 9 || exit 75
rsync -a --delete --exclude=node_modules --exclude=/.git --exclude=/.chat-window-receipts/ ./ "$build_dir/"
cd "$build_dir"
rm -rf .chat-window-receipts
mkdir -p .chat-window-receipts
trap 'cp -a .chat-window-receipts "$source_dir/"' EXIT
exec > >(tee .chat-window-receipts/validation.log) 2>&1
printf 'host=%s\nrevision=%s\nstages=%s\n' "$(hostname)" "${DASH_PROOF_REVISION:-uncommitted}" "${CW_STAGES:-all}"
mirror="$HOME/.cache/dash-native-notifications-share-build/.native-build-inputs/aodl.git"
if [ -d "$mirror" ]; then
  export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.file://$mirror.insteadOf" GIT_CONFIG_VALUE_0=ssh://git@github.com/kvnloo/aodl-views.git GIT_ALLOW_PROTOCOL=file:https:ssh
fi
if [ ! -d .git ]; then git init -q; fi
set -e
bun install --frozen-lockfile
(cd bridge && bun install --frozen-lockfile)
(cd app && bun install --frozen-lockfile)
git add .
set +e
fail=0
stage() {
  local name="$1"; shift
  printf '\n== %s ==\n' "$name"
  "$@" > ".chat-window-receipts/$name.log" 2>&1
  local code=$?
  printf '%s exit=%s\n' "$name" "$code"
  [ "$code" = 0 ] || fail=1
}
want() { [ "${CW_STAGES:-all}" = all ] || [[ ",${CW_STAGES}," == *",$1,"* ]]; }
want typecheck && stage typecheck bun run typecheck
want lint && stage lint bun run lint
want lint && stage lint-owned bun x eslint --max-warnings 0 app/App.tsx app/src/navigation.ts app/src/screens/ChatScreen.tsx app/src/screens/panes/ChatsPane.tsx app/src/components/ChatWindow.tsx app/src/components/ComposerActionMenu.tsx app/src/components/Composer.tsx app/src/lib/chat-window.ts app/src/lib/chat-window.test.ts app/src/lib/filter-gesture.ts app/src/store/composer-draft.ts app/src/debug/controller.ts scripts/mutate.ts scripts/mutate.test.ts
want focused && stage focused bun test app/src/lib/chat-window.test.ts scripts/mutate.test.ts
want unit && stage unit bun run test
want mutation && stage mutation bun scripts/mutate.ts --file app/src/lib/chat-window.ts
want mutation-all && stage mutation-all bun scripts/mutate.ts
want export && stage android-export bash -c 'cd app && CI=1 bun x expo export --platform android --output-dir ../.chat-window-receipts/android-export'
want render && stage rendered node scripts/chat-window-proof.mjs
want workspace && stage workspace-nav bash -c 'node scripts/workspace-navigation-proof.mjs && cp -a .workspace-ui-receipts .chat-window-receipts/workspace-ui'
printf '\nRESULT: %s\n' "$([ $fail = 0 ] && echo PASS || echo FAIL)"
exit $fail
