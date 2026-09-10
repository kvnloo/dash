# Dash: notes for agents and contributors

Dash is a phone app (Expo, Android + iOS) that chats with free-tier models in
parallel and with the coding agents on your own computer over Tailscale.

## Autodevelop

If you are an agent told to autodevelop, donate a coding pass, or pick the
next issue: read `.cursor/skills/autodevelop/SKILL.md` and run that loop.
Do not invent a parallel process. Workers open PRs; they never merge `main`.

## Layout

- `app/` Expo app. All UI lives in `app/src`.
- `bridge/` Bun WebSocket server that runs agent CLIs (omp, codex, grok, claude, hermes) on the computer. Entry: `bridge/index.ts`, adapters in `bridge/src/harnesses.ts`.
- `shared/protocol.ts` wire protocol between the two. Dependency-free; both sides import it.

## Ownership while several agents work at once

Parallel work happens in git worktrees under `.worktrees/`. Full map: `docs/orchestration.md`.

- Integration owner: this checkout, branch `integrate/device-layer`. Only this tree runs Metro and `dash-pair`.
- `svc/pair`: pairing HTTP + Pair screen.
- `svc/bridge-core`: WebSocket, token, harness spawn, STT.
- `svc/roster`: tailnet hosts + Bots pane.
- `svc/voice`: Voice screen + `voice_*` events.
- `svc/nav`: AppNav + CSS probe.
- `svc/chat-core`: Chat, Composer, turn store.
- `svc/hermes-session`: Dash → Hermes gateway/peer (missing). Do not replace the bridge.
- `shared/protocol.ts`: tiny backward-compatible changes only; land before consumers.

Non-trivial work uses `/poteto-mode`. Prove it with `.cursor/skills/verify-dash` (`bun scripts/verify-dash/control-dash.ts`). The nano-service queue lives in `orchestrate/dash/`.

Anyone adding an app dependency: run `bunx expo install <pkg>` from `app/`, never edit `package.json` by hand, and keep the app runnable in Expo Go (no native modules outside the Expo SDK).

If you need a protocol change, add it to `shared/protocol.ts` with a parser update and keep old fields working.

## Conventions

- TypeScript strict. `unknown` at boundaries, parsed into named types. No `as` casts, no `any`.
- No new dependencies for things under 100 lines.
- Pure black UI, system font, one accent. Match the existing components before adding new ones.
- Streaming text goes through `app/src/store/text.ts` (per-reply subscriptions, rAF-coalesced). Never put per-token updates in the chats store.
