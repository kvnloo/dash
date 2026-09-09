# Pair over Tailscale

Pairing lets the phone trust this laptop. The user taps **Pair over Tailscale** and lands in Main with a live WebSocket. Agents prove the laptop side without claiming the live code.

## Sub-features

- `pair-session` publishes a 6-character unbound code on `GET /pair`.
- `pair-address` names Tailscale `100.78.215.21:4747`, not MagicDNS `mbp`.
- `pair-claim` (phone only) exchanges the code for `~/.dash/token`. Do not run this from verify by default.
- `pair-ws` is the phone opening `/ws?token=`. Logged on the bridge as `ws.open`.

## How to get to it (user POV)

- First launch with no saved settings: Pair screen.
- Settings → pair again.
- Deep link `dash://connect?address=100.78.215.21%3A4747&code=XXXXXX`.

## Driving it with control-dash

Preconditions:

- `dash-pair` is healthy.
- `control-dash doctor` sees `{ ok: true }` and `codeLen: 6`.

- **Read the live code.** Run `bun scripts/verify-dash/control-dash.ts pair`. Exit 0. `artifacts/verify-dash/pair.json` has `codeLength: 6` and `address` containing `100.78.215.21`.
- **Do not claim.** Do not `POST /pair/claim`. That binds the laptop token and can knock the phone off.
- **Phone path (human).** Computer field `100.78.215.21`. Tap **Pair over Tailscale**. Main appears. Bridge log `ws.open remote=100.117.226.39`.
- **Proof.** Keep `pair.json`. If the phone was used, quote the `ws.open` line. A 6-char code without a later `ws.open` only proves the laptop is advertising pairing, not that the phone connected.

## Gotchas

- `GET /pair` is enough to mint or refresh an unbound session. That is expected.
- Hostname `mbp` resolves to `127.0.1.1` on this laptop. Always use the Tailscale IP.
- Port `7331` is leftover `dash-bridge`. Pair HTTP there is the wrong process.
