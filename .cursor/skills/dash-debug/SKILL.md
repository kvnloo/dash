---
name: dash-debug
description: Debug Dash pair → roster → WebSocket hello/attach on :4747. Use when pairing fails, hello is missing, attach drops events, or a harness turn hangs. Never paste tokens.
---

# Dash debug

**When to use:** Pair screen stuck, `/roster` empty, phone chat silent after screen lock, or a harness turn never `done`. Phone is Expo Go. Laptop is `dash-pair` on port 4747.

Do not start a second `dash-pair` or Metro on 8097. Do not `POST /pair/claim`. Do not print `~/.dash/token`.

Runtime proofs: `.cursor/skills/verify-dash`. Architecture: `.cursor/skills/dash-bridge`.

## 1. Doctor the live bridge

```bash
bun scripts/verify-dash/control-dash.ts doctor
```

Need:

- `GET /` → `{ ok: true }`
- `GET /pair` → 6-character `code`
- `GET /roster?token=<file>` → 200 with `hosts[]`

Token path is `$HOME/.dash/token`. Read it into a local var. Never echo it. Never commit it. Never paste it into chat.

If doctor fails, stop. The phone cannot pair a dead process.

## 2. Pair path (HTTP, not WS)

Phone Pair screen talks HTTP first.

| Symptom | Check |
|---------|--------|
| Pair code never appears | `GET /pair` on the laptop. MagicDNS `mbp` is often wrong. Use Tailscale IPv4 (`100.64.0.1`). |
| Listen for sound does nothing | Pair audio is queued. Do not rewrite the decoder while debugging attach. |
| LAN pair fails, Tailscale works | `DASH_HOST` must not be pinned to Tailscale-only. `bun run start` listens on all interfaces. |

Evidence: `artifacts/verify-dash/pair.json` from `control-dash.ts pair`. `codeLength === 6`. No token in the artifact.

## 3. Roster path

```bash
bun scripts/verify-dash/control-dash.ts roster
```

Writes `artifacts/verify-dash/roster.json`. Host names come from the live probe, not the app store.

| Symptom | Check |
|---------|--------|
| No hosts | Tailscale not up, or bridge not on the tailnet. |
| Cursor empty | Expected until a Cursor agent joins Hermes. Not a parse bug. |
| grok-bot missing while desktop Grok is open | Roster should list grok-bot when the desktop app is alive. See `bridge/src/roster.ts`. |
| Probe hangs | `timedArgv` wraps `hermes gateway list`. A hang here is a roster bug, not a WS bug. |

## 4. WebSocket hello

Phone opens `ws://<ip>:4747/ws?token=...`.

On connect the bridge must send `{ type: "hello", version, host, cwd, harnesses }`. Old phones still parse hello without `hosts`.

| Symptom | Check |
|---------|--------|
| Socket opens, no hello | Token mismatch. Compare length only (`>= 16`), not the value, in logs. |
| `harnesses[].available` all false | `Bun.which(bin)` on the laptop PATH of the bridge process, not your interactive shell. |
| `o8` or `firstmate` in hello | Bug. Those are not spawn targets. |

Do not send a real `chat` turn unless the issue asks for it. A `hello` frame is enough to prove the socket.

## 5. Attach replay (screen lock)

Turns outlive sockets. After unlock the phone sends:

```json
{ "type": "attach", "turns": [{ "id": "<turnId>", "seq": <lastSeen> }] }
```

Bridge replays events with `seq > lastSeen`. Unknown ids get `{ type: "lost", id }`.

| Symptom | Check |
|---------|--------|
| Chat blank after unlock | Client `seq` too high, or turn pruned (10 min / max 50). |
| Duplicate deltas | Client applied replay on top of events it already had. |
| Turn never `done` | Child still running. On main the spawn path waits on `proc.exited` with no hang timer until turn-safety lands. Cancel is exit 130. |

## 6. Turn / harness stdout

| Symptom | Check |
|---------|--------|
| Silence, process still running | `ps` the child. Main has no hang kill. Look for `turn.start` without `turn.end` in bridge stderr. |
| `{`-prefixed garbage, no error | Parser currently drops non-JSON object lines. A structured `error` event is the intended contract. |
| Non-zero exit, no error | Bridge should already `error` with stderr tail or `"<name> exited with code N"`. |
| Hermes slow | Gateway/peer path in `hermes-session.ts`. `hermes chat -q` is fallback. |

Logs: bridge stderr lines `turn.start` / `turn.parse_error` / `turn.end`. No tokens.

## 7. App UI without the phone

Debug web on **8099** only:

```bash
cd app && EXPO_PUBLIC_DEBUG=1 EXPO_PUBLIC_DEBUG_AUTONAV=0 bunx expo start --web --port 8099
```

Then `window.__DASH_DEBUG__.scenario("chat-omp")`. Screenshots: `bun scripts/verify-dash/control-dash.ts screenshot --scenario chat-omp`.

Never treat Metro 8097 as disposable. That is the phone bundler.

## Do not

- Paste tokens, pair codes you claimed, or Tailscale auth keys.
- `pkill` Metro or stop `dash-pair` you did not start.
- Open a second listener on 4747.
- Mark Linear Done from this repo.

## Evidence paths

| Kind | Path |
|-------|------|
| Doctor / pair / roster | `artifacts/verify-dash/` (gitignored) |
| Unit | `bun test app/src bridge/src shared` |
| Mutation | `bun scripts/mutate.ts` score ≥ 80 |
| Device pixels | `.maestro/` |
