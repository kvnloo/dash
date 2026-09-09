# Dash verification map

This directory is the maintained source for verifying user-facing Dash behavior. Read the index before driving the app, then use the matching feature file.

## Baseline preconditions

- Live bridge at `http://100.78.215.21:4747` (`dash-pair`).
- Token at `~/.dash/token` for `/roster` only. Never claim a new token during verify.
- Phone, if used: Expo Go on `kevins-s25-ultra` (`100.117.226.39`), computer field `100.78.215.21`.
- `control-dash doctor` reports `{ ok: true }` and a 6-char pair code.
- Never start a second bridge. Never bind Metro 8097. Debug web is 8099.

## Driving conventions

- Start from doctor. Fail closed if the bridge is down.
- Prefer ARIA labels (`Bots`, `Chats`, `Orchestra`, `Pair over Tailscale`) over coordinates.
- Treat every command as literal.
- Bridge actions go through `control-dash`. Debug UI actions go through `window.__DASH_DEBUG__`.
- Cleanup removes disposable 8099 processes, never proof artifacts, never `dash-pair`.

## Proof and skip reporting

- Capture the command and the resulting JSON or screenshot, not only a pass/fail.
- Mutation proof (claim, send chat) is out of band unless the unit names it. Default proofs are read-only on the live bridge.
- Record the feature ID with every artifact under `artifacts/verify-dash/`.
- Report an unreachable path with the attempted command. Do not mark it verified via a different path.

## Features

- [Pair over Tailscale](./pair.md) is the first-run path to a live WebSocket.
- [Host roster](./roster.md) is the Bots tab list of tailnet machines.
- [Pager gold](./nav.md) is the collapsed 3-dot nav indicator.
- [Chat turn](./chat.md) is a harness thread on the phone.
- [Voice](./voice.md) is spoken turns through the expand control.
