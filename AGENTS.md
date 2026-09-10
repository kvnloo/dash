# Dash: notes for agents and contributors

Dash is a phone app (Expo, Android + iOS) that chats with free-tier models in
parallel and with the coding agents on your own computer over Tailscale.

## Autodevelop

If you are an agent told to autodevelop, donate a coding pass, or pick the
next issue: read `.cursor/skills/autodevelop/SKILL.md` and run that loop.
Do not invent a parallel process. Workers open PRs; they never merge `main`.

## Verification

AI-native work is untrusted until it is proven. Pyramid:

1. **Unit** — `bun test app/src bridge/src shared` (or `bun test` at the repo root).
2. **TDD** — `.cursor/skills/tdd/SKILL.md`. Fail, then pass. Pin numbers that lock UI geometry.
3. **Mutation** — `bun scripts/mutate.ts` on `golden-nav.ts`, `bridge-pull.ts`, `motion.ts`, `shared/protocol.ts`, `bridge/src/roster.ts`. Score must stay ≥ 80. This is how an accidental `NAV_CHROME_HEIGHT = 80` dies in CI instead of shipping.
4. **Runtime** — `.cursor/skills/verify-dash` against live `dash-pair`.
5. **Device** — Maestro in `.maestro/` for pixels the unit suite cannot see. Nav-dot centering: `.maestro/nav-dots.yaml` (never relaunch Expo Go) and `bun scripts/assert-nav-dots.ts` on the cropped chrome PNG; CI runs `bun test scripts/assert-nav-dots.test.ts`.

Do not skip mutation because the unit tests are green. Surviving mutants are missing assertions.

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

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
