#!/usr/bin/env bash
# Install the turbo dogfood loop on the Studio (macOS, launchd). Reversible: --uninstall.
#
# Creates (all under $HOME):
#   ~/dash-studio-preview          git worktree of ~/dash-studio on branch turbo/preview (node_modules are APFS clones)
#   ~/dash-turbo/{bin,wt}          turbo-new / turbo-promote / turbo-done / turbo-status / turbo-off / turbo-on
#   ~/dash-turbo/TURBO.md, .claude/settings.json    the turbo agent's brief and scoped permissions
#   ~/Library/LaunchAgents/dev.kvnloo.dash-metro-preview.plist   preview Metro :8098, watch + hot reload
#   ~/.local/state/dash/           preview.json (current good preview) and preview-history.jsonl (every gate run)
# Never touches ~/dash-studio's working tree, dev.kvnloo.dash-metro (:8097) or dev.kvnloo.dash-bridge.
set -Eeuo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STABLE="$HOME/dash-studio"; PREVIEW="$HOME/dash-studio-preview"; TH="$HOME/dash-turbo"
PLIST="$HOME/Library/LaunchAgents/dev.kvnloo.dash-metro-preview.plist"
BUN="$HOME/.bun/bin/bun"

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "gui/$(id -u)/dev.kvnloo.dash-metro-preview" 2>/dev/null || true
  rm -f "$PLIST"
  echo "preview Metro removed. Kept: $PREVIEW (git worktree), $TH, ~/.local/state/dash. Remove the worktree with: git -C $STABLE worktree remove $PREVIEW"
  exit 0
fi

BASE="${TURBO_PREVIEW_BASE:-$(git -C "$here" rev-parse HEAD)}"
if [[ ! -d "$PREVIEW" ]]; then
  git -C "$STABLE" worktree add -B turbo/preview "$PREVIEW" "$BASE"
fi
[[ -d "$PREVIEW/app/node_modules" ]] || cp -cR "$STABLE/app/node_modules" "$PREVIEW/app/node_modules"
[[ -d "$PREVIEW/bridge/node_modules" ]] || cp -cR "$STABLE/bridge/node_modules" "$PREVIEW/bridge/node_modules"
[[ -d "$PREVIEW/node_modules" ]] || (cd "$PREVIEW" && "$BUN" install --frozen-lockfile)   # root devDeps: @types/bun, playwright types for tsc -p app
git -C "$PREVIEW" update-index --skip-worktree app/src/lib/build-info.json

mkdir -p "$TH/bin" "$TH/wt" "$TH/.claude" "$HOME/.local/state/dash" "$HOME/Library/Logs/dash"
for t in turbo-new turbo-promote turbo-done turbo-status turbo-off turbo-on; do install -m 0755 "$here/$t" "$TH/bin/$t"; done
install -m 0644 "$here/agent-home/TURBO.md" "$TH/TURBO.md"
install -m 0644 "$here/agent-home/.claude/settings.json" "$TH/.claude/settings.json"
# Claude Code ignores a folder's .claude/settings.json until the folder is trusted (measured: rules
# matched only after hasTrustDialogAccepted). Trust exactly ~/dash-turbo; a backup of ~/.claude.json is kept.
python3 -I "$here/trust-agent-home.py" "$HOME/.claude.json" "$TH"
install -m 0644 "$here/dev.kvnloo.dash-metro-preview.plist" "$PLIST"
plutil -lint "$PLIST" >/dev/null
launchctl bootout "gui/$(id -u)/dev.kvnloo.dash-metro-preview" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
for _ in $(seq 1 90); do [[ "$(curl -s -m 2 http://127.0.0.1:8098/status)" == *running* ]] && break; sleep 1; done
echo "preview :8098 $(curl -s -m 3 http://127.0.0.1:8098/status || echo down) serving $(git -C "$PREVIEW" log -1 --format=%h)"
echo "phone: exp+dash://expo-development-client/?url=http%3A%2F%2F100.100.77.46%3A8098"
