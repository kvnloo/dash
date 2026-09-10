# Dash orchestration: worktrees and nano-services

This is the split after the **device-layer checkpoint** (`integrate/device-layer`, phone paired over Tailscale). Do not merge that branch to `main` until the pieces below land through this pipeline.

## Layers (do not collapse)

```
clients
  Dash phone · Hermes TUI · Telegram · Grok Bot · Muse (Hermes peer)
        |
        v
device / session fabric          <- Dash bridge  (this repo)
  pairing, WS, voice, CLI spawn, host roster
        |
        v
agent fabric                     <- Hermes (not this repo)
  memory, skills, profiles, kanban, peer run mbp <-> groot
        |
        v
governance                       <- stay off the phone
  Linear, Keel, oss-factory, Maintainer Review
```

The phone talks to **one** Bun process on the laptop: `dash-pair` at `100.64.0.1:4747`. Hermes gateway (`:9900`) and `hermes peer` are a different universe until `svc/hermes-session` wires them.

## Live processes (do not duplicate)

Only the integration checkout may run these:

| Name | Bind | Role |
|------|------|------|
| `dash-pair` | `100.64.0.1:4747` | pairing HTTP + `/ws` + `/roster` |
| `dash-metro-8097` | `exp://100.64.0.1:8097` | Expo bundler |
| `dash-bridge :7331` | ignore | leftover probe |
| Hermes gateway | `:9900` | not Dash |

Feature worktrees **never** start a second bridge or Metro.

## Worktrees

Root checkout: `/home/you/workspace/dash` on `integrate/device-layer` (integration owner).

Feature checkouts live under `.worktrees/` (gitignored). Each has its own branch from the checkpoint:

| Worktree | Branch | Owns | Must not touch |
|---------|--------|------|----------------|
| `.worktrees/pair` | `svc/pair` | `PairScreen`, `pair-api`, `pair-crypto`, `sonic-pair`, `bridge/pair-audio.ts`, `bridge/pair-decode.ts`, `/pair/*` | chat UI, AppNav, roster |
| `.worktrees/bridge-core` | `svc/bridge-core` | `bridge/index.ts` WS, harness spawn, token, reconnect, STT | pairing audio, Bots pane, AppNav |
| `.worktrees/roster` | `svc/roster` | `bridge/src/roster.ts`, `app/src/lib/roster.ts`, `BotsPane`, `hello.hosts` | pairing, nav pixels |
| `.worktrees/voice` | `svc/voice` | `VoiceScreen`, `vad`, `speak`, `voice-session`, `voice_*` events | pairing, AppNav |
| `.worktrees/nav` | `svc/nav` | `AppNav*`, `golden-nav.ts`, nav assets, `docs/design/nav-probe.html` | pairing, bridge |
| `.worktrees/chat-core` | `svc/chat-core` | Chat, Composer, `store/app.ts` turn pipeline | pairing, roster |
| `.worktrees/hermes-session` | `svc/hermes-session` | Dash to Hermes gateway/peer adapter, profile agents on roster | pairing HTTP, AppNav pixels |

Shared contract: **`shared/protocol.ts`**. Anyone who needs a new field opens a tiny protocol change first (backward compatible). Other worktrees may read it; only the protocol change may rewrite parsers.

`bridge/index.ts` is the shared mutation boundary. Pair/roster/voice/hermes-session must not all edit it in parallel. Route HTTP handlers through small modules (`pair-decode.ts`, `src/roster.ts`, later `src/hermes-session.ts`) and keep `index.ts` as wiring.

## Nano-services (same process, separate modules)

These are not extra ports. They are modules inside `dash-pair` with hard edges:

1. **pair** — HTTP only. Returns immediately; playback is queued.
2. **session** — WebSocket, token, `attach` replay.
3. **spawn** — omp / grok / codex / claude / hermes-CLI / pi / fx.
4. **roster** — Tailscale + live OMP tabs to `HostInfo[]`.
5. **speech** — sherpa STT, already in the spoken-turns commit.
6. **hermes-session** (missing) — `harness: "hermes"` goes to gateway/peer, not `hermes chat -q`.

Grok Bot and Muse install Hermes locally and join as **peers/profiles**. They do not speak Dash's WebSocket.

## pstack workflow

This program is a pstack **Orchestrate** (standing coordinator) with an **Autopilot-stack** landing rule: workers build and verify, the operator lands `integrate/device-layer` → `main`.

| Piece | Path |
|-------|------|
| Model roles | `~/.cursor/rules/pstack-models.mdc` |
| Repo rule | `.cursor/rules/pstack-dash.mdc` |
| Verify skill | `.cursor/skills/verify-dash/` |
| TDD skill | `.cursor/skills/tdd/` |
| Control CLI | `bun scripts/verify-dash/control-dash.ts` |
| Mutation | `bun scripts/mutate.ts` (score ≥ 80) |
| Store | `orchestrate/dash/` (`ORCH_STORE=orchestrate/dash`) |
| Bookkeeping | `bun scripts/pstack/orch.ts --store orchestrate/dash status` |
| Playbook | `/poteto-mode` → Orchestrate; workers are `poteto-agent` |

Entry:

```text
/poteto-mode own the Dash nano-service program in orchestrate/dash until integrate/device-layer is merge-ready. do not merge to main.
```

One writer per worktree. Completions are queue events. Verify with `verify-dash` before a unit is `done`. Nav is already `done` at `1ef1323`.

## Integration order before `main`

1. Protocol (if any) — tiny, old fields still parse.
2. `svc/bridge-core`
3. `svc/pair`
4. `svc/roster`
5. `svc/voice`
6. `svc/chat-core`
7. `svc/hermes-session`
8. `svc/nav` last (pixel work is independent of pairing)

Merge each into `integrate/device-layer`. Integration owner runs Expo + `dash-pair` once. Only then: PR `integrate/device-layer` to `main`.

## Agent rules

- One agent per worktree. Same-file edits are not guaranteed to merge.
- Skip formatters, `tsc`, and Metro in feature worktrees. Integration owner runs them once.
- Protocol change: keep `hosts?` and old `hello` working.
- Native Expo Go cannot run CSS `oklch` / `color-mix` 1:1. Nav web copy is `AppNav.web.tsx`; native stays WebView/CSS or StyleSheet.
- MagicDNS `mbp` is broken on this laptop. Phone and docs use `100.64.0.1`.

## Checkpoint that made this split legal

- Branch `integrate/device-layer`
- Phone `100.64.0.3` opened `ws` on `dash-pair`
- Design frames / nav-probe PNGs remain uncommitted on the integration tree
