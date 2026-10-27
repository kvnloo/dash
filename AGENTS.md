# Dash: notes for agents and contributors

**Testing Dash (every agent and harness):** test only via `.claude/skills/verify-dash/SKILL.md`, the e2e tester army (`e2e/mbp-army`). Never native_journeys, ad-hoc scripts, unit tests or the owner's phone as proof, and never call a feature working unless an army spec drove it. This overrides the Verification pyramid and `.cursor/skills/verify-dash` below.

Dash is a phone app (Expo, Android + iOS) that chats with free-tier models in
parallel and with the coding agents on your own computer over Tailscale.

## Release law O15: tester army or nothing ships

Read this before you build, install, promote or merge Dash.

- The test suite is the e2e tester army: `bun run test` (`scripts/army.sh`, specs in `e2e/mbp-army`). It writes a receipt for the exact commit.
- No green, complete army receipt for that exact commit: no APK, no phone install, no channel/OTA promotion, no merge. `laws/release/check.py` decides; `scripts/build-native-android.sh`, `scripts/phone-install.sh`, CI and `promote-preview.yml` call it and exit non-zero before anything is built, signed or installed.
- The law and its proof are in `laws/release/` (Bend, O15). Do not weaken a law, edit the army, or hand-write a receipt to get a pass; the checker rejects all three.
- Ad-hoc harnesses and one-off proof scripts never count. Put a new journey in `e2e/mbp-army/army.spec.ts` and its feature in `features.json`.

## Autodevelop

If you are an agent told to autodevelop, donate a coding pass, or pick the
next issue: read `.cursor/skills/autodevelop/SKILL.md` and run that loop.
Do not invent a parallel process. Workers open PRs; they never merge `main`
or `dev`.

## Verified OSS Loop

Dash is onboarded to [Verified OSS Loop](https://github.com/kvnloo/verified-oss-loop)
(`SPEC.md` v0.1, kit revision in `.verified-oss-loop/inventory.yml`). Scheme:
**rolling**. This is the contribution contract, not a second product loop.

```bash
python3 .verified-oss-loop/rollout.py show
```

| Channel | Role |
|---|---|
| `preview` | Day-pass feature PR target. Automerge after required checks. |
| `nightly` | Overnight AI and OMP fast-forward. `overnight/critical-path-*` lands here. |
| `dev` | Gated integration. Workers never merge. |
| `main` | Production. Maintainer merge only. Never force-push. |

Workers branch from `origin/nightly` (`worker_base`). Day-pass PRs target
`preview` (`feature_target`). Unattended overnight PRs target `nightly`. Do not
open a pile of PRs at `main` unless a human named that base.

Claims are 24h leases (`claimed` / `claimable`). Every PR binds an evidence
receipt (`head_revision` must be this PR's SHA). Receipt CI runs on
`preview` and `nightly` only so existing `main` PRs are not retroactively failed.

| Layer | Command |
|---|---|
| Test suite (tester army, O15) | `bun run test` |
| Runtime | `.cursor/skills/verify-dash` (`bun scripts/verify-dash/control-dash.ts`) |

Kit skills live in `skills/`. Dash-owned skills stay in `.cursor/skills/`
(autodevelop, tdd, verify-dash, dash-*). Prefer `.cursor/skills/` when both
exist. Re-running `oss-onboard` must not overwrite `source: local` skills.

## Verification

AI-native work is untrusted until it is proven.

1. **Tester army** — `bun run test` (`scripts/army.sh`, specs in `e2e/mbp-army`). This is the only test suite. A new behaviour gets an army journey and a `features.json` entry, never a unit test.
2. **Release law O15** — `laws/release/`. No green, complete army receipt for the exact commit: no APK, install, promotion or merge (see the O15 section above).
3. **Typecheck / lint** — `bun run typecheck`, `bun run lint`.
4. **Device** — web army evidence is not native acceptance (IME, voice, permissions); say so instead of claiming it.

## Layout

- `app/` Expo app. All UI lives in `app/src`.
- `bridge/` Bun WebSocket server that runs agent CLIs (omp, codex, grok, claude, hermes, pi, fx) on the computer. Entry: `bridge/index.ts`, adapters in `bridge/src/harnesses.ts`.
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
