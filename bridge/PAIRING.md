# Pair a client with the bridge

Start `bun bridge/index.ts` on a machine with Tailscale connected. The bridge binds its detected Tailscale IPv4. A missing address stops startup. `DASH_HOST` can select only that detected address.

The bridge creates two private files under `~/.dash`. `bootstrap-token` authorizes enrollment. `token` authorizes the existing WebSocket and roster APIs. Both files have mode `0600`. The bridge never prints either value or a pairing code.

1. Transfer `~/.dash/bootstrap-token` privately to the client that you want to enroll.
2. Send `GET /pair` to the bridge's Tailscale address with `Authorization: Bearer <bootstrap-token>`.
3. Enter the returned six-character code in your client.
4. Send `POST /pair/claim` with the same authorization header and JSON `{"code":"<code>"}`.
5. Store the returned `token` in the client's secure credential storage. Use that token for `GET /roster` and `/ws`.

A code expires after three minutes and works once. Creating a sonic session does not replace the manual session. All `/pair` routes require the bootstrap header, including `/pair/intent`, `/pair/beep`, `/pair/hear`, and `/pair/claim`. The execution token cannot authorize enrollment. A bootstrap token cannot authorize a WebSocket or roster request. Query parameters cannot supply bootstrap authentication.

Sonic pairing sends a 32-byte base64url `claimKey` to `/pair/intent`. `/pair/hear` accepts the same key plus base64 audio. The heard code must match a live session bound to that key. `/pair/claim` also accepts `claimKey` for clients that decode tones themselves.

The root metadata endpoint requires either credential in an authorization header. `/roster` and `/ws` accept the execution credential in an authorization header. Their existing `token` query parameter remains compatible with older paired clients. Keep credentials out of logs and shared URLs.

Pair routes allow 12 requests per socket address per minute. Forwarded headers do not change that address. JSON claims are limited to 16 KiB, encoded audio to 1 MiB after decoding, and ffmpeg output to twelve seconds. Audio workers have a ten-second timeout. Credential responses use `Cache-Control: no-store`.

`DASH_CREDENTIAL_DIR` optionally selects an isolated private credential directory without changing HOME or agent login state.

For an isolated local verification server, explicitly set both `DASH_ALLOW_LOOPBACK=1` and `DASH_HOST=127.0.0.1`. `::1` is also allowed. This opt-in does not permit wildcard or LAN bindings. Use a disposable process and credential directory for tests. Do not change the running `dash-pair` service.

Run the security checks from the repository root:

```sh
bun test bridge/src/bridge-security.test.ts bridge/src/bridge-security-entry.test.ts bridge/src/pairing-http.test.ts bridge/src/pairing-audio.test.ts
```

These checks start ephemeral loopback servers and owned bridge subprocesses. They do not claim a pairing session from the live bridge or send an agent turn.
