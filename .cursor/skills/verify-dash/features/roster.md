# Host roster

The Bots tab lists tailnet hosts (mbp, groot, the phone, cursor) with installed harnesses. The phone receives the same list on WebSocket `hello.hosts`.

## Sub-features

- `roster-http` is `GET /roster?token=`.
- `roster-hello` is `hosts` on the WS `hello` event.
- `roster-bots-tab` is Main pager index 0.

## How to get to it (user POV)

- Main → swipe or tap **Bots**.
- Debug: `window.__DASH_DEBUG__.run({ action: "setMainTab", index: 0 })`.

## Driving it with control-dash

Preconditions:

- Token file `~/.dash/token` matches the running `dash-pair`.
- Doctor passed.

- **HTTP.** Run `bun scripts/verify-dash/control-dash.ts roster`. Exit 0. `artifacts/verify-dash/roster.json` `names` includes `mbp` (or this host) and the phone when it is online.
- **Unit tests.** Run `bun scripts/verify-dash/control-dash.ts test`. `roster` exit 0.
- **UI (optional 8099).** Scenario `main-bots`. Screenshot shows host rows, not an empty pane.
- **Proof.** `roster.json` plus, if UI was driven, `shots/main-bots.png`.

## Gotchas

- 401 means the token file is stale vs the process that started `dash-pair`.
- Groot may appear as a host without a working Dash chat path. Listing is not the same as sending a turn there.
