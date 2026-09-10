---
name: verify-dash
description: Drive Dash (Expo phone + Tailscale Bun bridge) and prove pairing, roster, nav, and chat. Use when a Dash change needs runtime evidence, not just a passing compile.
---

# Verify Dash

Dash is a phone app. The user surface is Expo Go on the S25 Ultra. Agents prove behavior from this laptop against the **live bridge** and **unit tests**, plus optional Expo **debug web** on 8099. Do not treat Metro 8097 as a disposable instance. That is the phone's bundler.

## Launch

Live processes (integration checkout only):

| Name | Bind | Role |
|------|------|------|
| `dash-pair` | `127.0.0.1:4747` (`DASH_BRIDGE`) | pairing HTTP + `/ws` + `/roster` |
| `dash-metro-8097` | `exp://127.0.0.1:8097` | Expo Go bundler |

Doctor against those. Do not `hub start` a second bridge. Do not bind another Metro on 8097.

UI proofs that need `window.__DASH_DEBUG__` start a **disposable** debug web on **8099**:

```bash
cd app && EXPO_PUBLIC_DEBUG=1 EXPO_PUBLIC_DEBUG_AUTONAV=0 bunx expo start --web --port 8099
```

Ready when `http://127.0.0.1:8099` answers. Teardown is SIGTERM on that child only.

A short-lived CLI proof has no extra server: `bun scripts/verify-dash/control-dash.ts`.

## Doctor

```bash
bun scripts/verify-dash/control-dash.ts doctor
```

Require:

- `GET http://127.0.0.1:4747/` returns `{ ok: true }`
- `GET /pair` returns a 6-character `code`
- `GET /roster?token=$HOME/.dash/token` is 200 with `hosts[]`
- Metro 8097 may be up; absence is not a doctor fail if this unit is bridge-only

If doctor fails, stop. Do not invent a skip-pair screen. Do not claim a pair code (`POST /pair/claim` steals the phone session).

## Drive

```bash
bun scripts/verify-dash/control-dash.ts pair      # GET /pair, write artifacts/verify-dash/pair.json
bun scripts/verify-dash/control-dash.ts roster    # GET /roster, write roster.json
bun scripts/verify-dash/control-dash.ts test       # bun test app/src bridge/src shared
bun scripts/verify-dash/control-dash.ts mutate    # bun scripts/mutate.ts (score ≥ 80)
```

Phone reload after app changes: Expo Go shake → **Reload**. Pair computer field is the laptop Tailscale IPv4, not MagicDNS `mbp`.

The Main and Chat input docks are `KeyboardDock` (`KeyboardStickyView`). On the S25, focusing the bar must lift it with the IME. A screenshot with the keyboard covering "Message Dash" is a fail.

Phone UI is **Maestro**, not hand-rolled `adb`. CLI: `maestro` with JDK 21. MCP server: `maestro mcp` in `~/.cursor/mcp.json`. Flows live in `.maestro/`. Prefer `inspect_screen` / `run` / `take_screenshot` over `adb exec-out screencap` and uiautomator dumps.

Debug web (optional, port 8099 only):

1. Open `http://127.0.0.1:8099?debug=1`
2. Wait for `window.__DASH_DEBUG__.scenario`
3. `await window.__DASH_DEBUG__.scenario("main-chats")` or `run({ action: "setMainTab", index: 0 })`
4. Screenshot + `state()`

Stable handles: Pair screen button **Pair over Tailscale**, pager tabs `Bots` / `Chats` / `Orchestra`, expand → Voice, down chevron → Bridge details overlay, Edit on the overlay → Settings.

## Evidence

Default directory: `artifacts/verify-dash/` (gitignored). Cleanup must not delete it.

Proof standards:

- Pairing: HTTP `codeLength === 6` plus host/address. Never a claimed token in the artifact.
- Roster: host names from `/roster`, not a mocked store.
- Nav: `bun test app/src/components/golden-nav.test.ts` plus, if you have a phone screenshot, gold pill left on the selected tab. Geometry pins (`NAV_CHROME_HEIGHT === 60`, dots centered in `NAV_PILL_HEIGHT` slots) are mutation canaries — do not delete them to make a mutant survive.
- Mutation: `bun scripts/mutate.ts` score ≥ 80 on the contract files. A surviving mutant means the suite would miss that edit.
- Chat: a live `ws` `hello` or a debug scenario `chat-omp` screenshot. Do not POST a real agent turn unless the unit asks for it.

Mocks only at the debug seed boundary (`EXPO_PUBLIC_DEBUG=1`). Live bridge proofs do not go through debug seed.

## Cleanup

Kill only processes this run started (debug web 8099, playwright). Never `pkill` Metro. Never stop `dash-pair`. Leave `artifacts/verify-dash/` in place.

## Helpers

```bash
bun scripts/verify-dash/control-dash.ts doctor|pair|roster|test|mutate|screenshot [--scenario main-chats]
```

Screenshot helper reuses `scripts/debug-screenshots.mjs` on port 8099.
