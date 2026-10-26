# Agent reports (not approvals)

`bridge/bin/dash-notify "Build ready" "Tests passed" [--url dash://chat/<id>]`

The CLI uses Bun, reads `<DASH_CREDENTIAL_DIR>/token` (default `~/.dash/token`),
and sends `POST http://127.0.0.1:<port>/notice`. The port is `DASH_NOTICE_PORT`,
or `DASH_PORT + 1` (4748 by default). It does not read or print bootstrap tokens,
accept remote hosts, create credentials, or enqueue approvals. Exit codes: 0 accepted
(stdout is the notice id), 1 transport/auth/storage/rate failure, 2 invalid arguments.

## Local ingress and delivery

The reporting listener binds **127.0.0.1 only**, separately from the existing
Tailscale listener. `/notice` on the main listener returns 403. A header execution
Bearer token is mandatory, even when the bridge has no configured token. Browser
Origins and non-loopback peers are refused; forwarded headers are not trusted.
No unauthenticated reporting mode or query-token auth is offered here.

JSON is `{ "title": "...", "body": "...", "url": "dash://..." }`. Title and body
are required, nonblank and limited to 80 and 600 UTF-16 code units respectively;
URLs are optional, `dash:` only, up to 512 units. Requests are limited to 8 KiB.
Oversize text is rejected, not silently truncated. One shared fixed window allows
10 authenticated submissions per 60 seconds, including invalid submissions;
429 carries `Retry-After`. Restart resets that in-memory window.

The bridge mints a UUID, atomically writes its last 50 notices to
`<DASH_CREDENTIAL_DIR>/notices.json` (0600), then broadcasts to authenticated
WebSockets. Each newly opened socket receives that bounded history with the
same ids. The phone's serialized inbox merges by id, persists its last 50 locally,
and calls the existing `postNativeNotice` with `notice:<id>` once per retained
notice. Replay overlap and app restarts are quiet. This is bounded replay, not
an unbounded/durable delivery queue: reports older than 50 bridge entries are
not recoverable. A new phone receives the retained history.

Settings → **Notices · Agent reports** opens the newest-first inbox. Reports are
saved even when notifications are disabled or permission is denied; only system
delivery is suppressed then. Unlike replies and approvals, reports post a native
notification **even while Dash is in the foreground**: the app reconnects only
when it is open, so a report sent while the phone was away arrives by replay in
the foreground and must still reach the notification shade (once per unseen id). Supported
chat/approvals links use existing routing; unknown Dash links remain selectable
in the list and notifications fall back to the Notices screen. No remote URL is
executed automatically. Forgetting the bridge clears the local inbox and sends
`notices_clear`, which empties the bridge ring on disk (old bridges ignore it).

## Failure behavior

Notices are optional; chat never depends on them. If the loopback notice port
cannot bind (for example, it is already taken), the bridge logs
`notices.disabled` and prints `notices disabled` in its banner, and keeps serving
chat. If `notices.json` is corrupt, the bridge moves it aside to
`notices.json.corrupt-<ms>` (0600), logs `notices.quarantined`, and starts with an
empty ring.

This is a WebSocket/local-notification feature, **not an OS push service**.
If Android suspends Dash or drops its socket, replay happens on reconnect.
Native scheduling remains unavailable in Expo Go and on unsupported platforms,
as before; the in-app list still works.

## Operator approval required before deployment

Nothing in this branch installs an app, builds an APK, changes the bridge-current
symlink, or restarts services. Approve both parts, not just the bridge:

1. Integrate/review `feat/agent-notices` on the chosen release line. This branch
   starts from `origin/integrate/dash-live-unified`; reconcile newer deployed
   identity/voice changes rather than replacing them blindly. Re-run unit,
   protocol mutation (≥80), and typecheck gates on the exact integrated SHA.
2. Stage that exact SHA as a new immutable bridge release, with its locked
   dependencies, using the existing release procedure. Preserve the existing
   credential directory, token, identity/voice configuration and service drop-ins.
   Re-observe `systemctl --user show dash-bridge.service -p WorkingDirectory`
   and `readlink -f ~/.local/lib/dash/bridge-current`; record the rollback target.
   At implementation time the service used `~/.local/lib/dash/bridge-current/bridge`.
3. Check that the intended loopback notice port (normally 4748) is free. Approve
   an atomic `~/.local/lib/dash/bridge-current` switch to the staged release,
   followed by `systemctl --user restart dash-bridge.service`. Do not restart
   Hermes, z0bridge, Metro or unrelated services. Verify the bridge and the new
   **127.0.0.1-only** listener, auth refusal, and a privately authenticated notice.
4. Update the app JavaScript to the same integrated revision using the existing
   native development-client/Metro delivery workflow. No new native dependency
   is introduced. If the owner has only Expo Go, native notices will remain
   unavailable until an approved native-client install; do not promise push
   delivery from an Expo Go reload. Any required native build/install is a
   separate explicit approval, not part of this task.
5. On the owner's approved handset, enable Notifications, background Dash, send
   one CLI report, and verify one notification, its tap destination, the Settings
   inbox, and no duplicate after reconnect/reload. Verify foreground suppression
   and the notification-off case. Keep approvals unchanged. Revert the bridge
   symlink and app revision together if acceptance fails.
