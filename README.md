# Dash

Phone app (Expo) that talks to the coding agents on your laptop over Tailscale.

Black UI, one chat thread per harness (OMP, Codex, Grok, Hermes, Claude Code when installed). Streams replies live; reconnects after the screen locks.

## Quick start (laptop)

```bash
# 1. Bridge — runs agent CLIs, listens on your tailnet
cd bridge && bun install && bun run index.ts
```

On first run the bridge prints:

- **Address** — your Tailscale IPv4, port `4747` (override with `DASH_PORT`)
- **Token** — stored in `~/.dash/token`; pass as `?token=` on the WebSocket URL

Optional env:

| Var | Default |
|-----|---------|
| `DASH_PORT` | `4747` |
| `DASH_HOST` | `0.0.0.0` (LAN + Tailscale) |
| `DASH_CWD` | directory you launched from |

```bash
# 2. App — scan QR with Expo Go (Android/iOS)
cd app && bun install && bunx expo install   # sync native deps
bunx expo start
```

## Pair the phone

1. Install **Expo Go** and join the same Tailscale tailnet.
2. Open Dash → **Pair with your laptop** (first launch) or **Chats → ⚙ Settings → Pair nearby (sonic)**.
3. Set **Computer name** to your laptop's Tailscale name (e.g. `mbp`), tap **Listen for pairing sound**.
4. Or enter **Address** + **Token** manually (Settings): `<tailscale-ip>:4747` and `~/.dash/token`.

**UI mock (no bridge):** `cd app && EXPO_PUBLIC_DEMO=1 bunx expo start`

**Debug mode (programmatic UI, no bridge):** `cd app && bun run debug` — or web + screenshots:

```bash
cd app && bun run debug:shots   # writes PNGs to screenshots/debug/
```

In debug mode, `window.__DASH_DEBUG__` exposes `scenario(id)`, `run({ action })`, and `state()`. Deep links: `dash://debug/scenario/chat-omp`.

**Static previews:** open `preview.html` in a browser. Pixel refs + storyboard: `docs/design/`.

## Layout

| Path | Role |
|------|------|
| `app/` | Expo UI |
| `bridge/` | Bun WebSocket server + harness adapters |
| `shared/protocol.ts` | Wire format (both sides import this) |

See `AGENTS.md` for multi-agent ownership rules.

## Contributing / AI Agents

- **Contributing guide:** See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute (unattended compute donation vs copilot paired PR workflow).
- **Onboarding:** [docs/loop/ONBOARDING.md](docs/loop/ONBOARDING.md) — use vs contribute decision tree.
- **Issue priorities:** [docs/loop/ISSUE_PRIORITY.md](docs/loop/ISSUE_PRIORITY.md) — impact/effort rubric toward the mesh vision.
- **Agent skills:** `.cursor/skills/` — short `SKILL.md` files for agents working on this repo:
  - `autodevelop` — the whole contribution loop. Any harness: read this and start.
  - `tdd` — fail-then-pass + mutation. Use this for every behavior change.
  - `dash-onboard` — first-run for any agent (layout, ownership, conventions).
  - `dash-bridge` — bridge architecture and harness adapter patterns (read-only guidance).
  - `dash-debug` — pair → roster → WS hello/attach on :4747. Never paste tokens.
  - `dash-contribute` — PR hygiene, fail-then-pass proofs, community norms.
  - `dash-android-ui` / `dash-motion` — phone UI (only if the issue assigns UI work).
  - `verify-dash` — runtime proofs against the live bridge.

Pixel language: [docs/design/language.md](docs/design/language.md). Competitor + AODL + frontier-kb UI map: [docs/design/ai-ui-patterns/](docs/design/ai-ui-patterns/README.md).

## Harness notes

- **OMP** — `omp -p --mode json`
- **Codex** — `codex exec --json` (~30–120s cold start)
- **Grok** — `grok --output-format streaming-json`
- **Hermes** — `hermes chat -q` (slow; may warn on toolsets)
- **Claude Code** — shown unavailable until `claude` is on `PATH`
- **Pi** — `pi --mode json`; unavailable until `pi` is on `PATH`
- **fx** — `fx ask --json --full-access` (Vercel Labs; not antonmedv/fx); unavailable until `fx` is on `PATH`

Each harness keeps its own session id for multi-turn threads.

Canonical ids: [kvnloo/aodl `harnesses/catalog.json`](https://github.com/kvnloo/aodl/blob/main/harnesses/catalog.json). `o8` is a control room; firstmate is a distro — neither is a Dash spawn target.

## Related

- IR: [kvnloo/aodl](https://github.com/kvnloo/aodl)
- Research: [kvnloo/frontier-kb](https://github.com/kvnloo/frontier-kb)
- Hermes governance: [kvnloo/hermes-keel](https://github.com/kvnloo/hermes-keel)
