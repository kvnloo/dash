# Turbo operations

## Bridge deploys

The bridge is deployed separately from the phone's web bundle. A web release does not upgrade the running bridge. Drain the old bridge **before** replacing its executable or restarting its service; an ordinary SIGTERM still cancels every active turn.

1. Send an authenticated `POST /drain` with the bridge's bearer credential. It returns HTTP **202** and stops accepting new `chat` and `voice_begin` turns immediately. `SIGUSR2` is an equivalent signal when HTTP is unavailable.
2. Poll authenticated `GET /health` while the old process is alive. It reports `release` (from `DASH_RELEASE_SHA`, otherwise the first token of `.dash-release-ready` in the repository root, otherwise `null`), `startedAtMs`, `running`, `waiting` (currently 0), `voiceSessions` and `draining`. Do not open new turns when `draining` is true.
3. **Wait for the old bridge process to exit**. It exits 0 when its active turn registry becomes idle. After `DASH_DRAIN_MAX_MS` (default 600000, ten minutes), it cancels any remaining turns through the existing shutdown path and exits. Treat a nonzero exit as a deployment failure.
4. Atomically repoint `bridge-current` to the reviewed new bridge release.
5. Run `systemctl --user restart dash-bridge` and check authenticated `GET /health` for the new `release` and `startedAtMs` before reconnecting the phone.

The drain reply to a newly attempted chat or recording is: “This computer is restarting for an update; try again in a minute.” In-flight text and voice turns are allowed to finish. Draining does not pause or restart the agent supervisor. Never repoint or restart before the old process exits unless accepting cancelled work as an emergency action.
