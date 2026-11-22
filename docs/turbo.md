# Turbo operations

## Bridge deploys

The bridge is deployed separately from the phone's web bundle. A web release does not upgrade the running bridge. Drain the old bridge **before** replacing its executable or restarting its service; an ordinary SIGTERM still cancels every active turn.

1. Send an authenticated `POST /drain` with the bridge's bearer credential. It returns HTTP **202** and stops accepting new `chat` and `voice_begin` turns immediately. `SIGUSR2` is an equivalent signal when HTTP is unavailable.
2. Poll authenticated `GET /health` while the old process is alive. It reports `release` (from `DASH_RELEASE_SHA`, otherwise the first token of `.dash-release-ready` in the repository root, otherwise `null`), `startedAtMs`, `running`, `waiting` (currently 0), `voiceSessions` and `draining`. Do not open new turns when `draining` is true.
3. **Wait for the old bridge process to exit**. It exits 0 when its active turn registry becomes idle. After `DASH_DRAIN_MAX_MS` (default 600000, ten minutes), it cancels any remaining turns through the existing shutdown path and exits. Treat a nonzero exit as a deployment failure.
4. Atomically repoint `bridge-current` to the reviewed new bridge release.
5. Run `systemctl --user restart dash-bridge` and check authenticated `GET /health` for the new `release` and `startedAtMs` before reconnecting the phone.

The drain reply to a newly attempted chat or recording is: “This computer is restarting for an update; try again in a minute.” In-flight text and voice turns are allowed to finish. Draining does not pause or restart the agent supervisor. Never repoint or restart before the old process exits unless accepting cancelled work as an emergency action.

## Studio dogfood loop (preview Metro :8098)

Kevin's phone can run a **preview** build that an agent changes live, next to the untouched **stable** Metro (:8097).
Install with `scripts/turbo/studio/install-studio.sh` (reversible: `--uninstall`).

- `~/dash-studio-preview` is a git worktree on `turbo/preview`, served by launchd `dev.kvnloo.dash-metro-preview` on :8098 with watch and hot reload. Only `turbo-promote` writes it.
- The agent is a Claude Code session in `~/dash-turbo` (brief: `TURBO.md`; scoped permissions in `.claude/settings.json`, effective only once the folder is trusted). Kevin opens it from Hosts › studio › Claude Code and types a request.
- `turbo-new <name>` makes an agent worktree; `turbo-promote <wt> "<note>"` gates it (no native files, `tsc -p app`, `tsc -p bridge`, bridge tests when touched, a throwaway Metro builds the Android bundle) and only then fast-forwards the preview, stamps `build-info.json` and re-checks :8098 (rolling back if it does not build). Every attempt lands in `~/.local/state/dash/preview-history.jsonl`; `preview.json` is the current good preview.
- `turbo-status` shows both Metros; `turbo-off` / `turbo-on` stop and restart the preview Metro and block promotions. None of them touch :8097 or the bridge.
- Phone: `exp+dash://expo-development-client/?url=http%3A%2F%2F100.100.77.46%3A8098` (preview) or `…8097` (stable).
