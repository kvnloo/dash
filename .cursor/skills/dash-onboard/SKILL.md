# Dash Onboard

**When to use:** First-run for any agent (Cursor, OMP, Hermes, etc.) opening the `kvnloo/dash` repo. Read this skill immediately to understand layout, ownership, and contribution workflow.

If the human said **autodevelop**, switch to `.cursor/skills/autodevelop/SKILL.md` now. This repo is onboarded to verified-oss-loop (`rolling`). `python3 .verified-oss-loop/rollout.py show` before you branch.

## What is Dash?

Dash is a phone app (Expo, Android + iOS) that chats with coding agents running on your laptop over Tailscale. The phone is a control surface; the laptop does the compute.

## Repo Layout

```
dash/
├── app/               # Expo app (React Native). UI lives in app/src/.
├── bridge/            # Bun WebSocket server (port 4747 on Tailscale).
│   ├── index.ts       # Entry point: WebSocket server, pairing, turn management.
│   └── src/
│       └── harnesses.ts  # Adapters for agent CLIs (omp, codex, grok, claude, hermes).
├── shared/
│   └── protocol.ts    # Wire protocol (dependency-free; imported by app + bridge).
├── docs/              # Design docs, storyboards, community loop docs.
├── .cursor/skills/    # Agent skills (short SKILL.md files for agents to read).
├── AGENTS.md          # Multi-agent ownership rules (READ THIS).
├── CONTRIBUTING.md    # Contribution guide (use vs contribute, unattended vs copilot).
└── README.md          # Quick start for users.
```

## Ownership Rules (from AGENTS.md)

**Do not edit these files** unless you are the assigned owner:

- `app/src/**`, `app/App.tsx`, `app/app.json`, `app/metro.config.js`: **UI session** (Kevin). These are mid-flight; do not touch.
- `bridge/**`, `shared/protocol.ts`: **Bridge session**.

**Anyone can edit:**

- `.cursor/skills/`, `docs/`, `CONTRIBUTING.md`, `README.md` (docs and skills).
- Tests, examples, and non-owned code.

## Conventions (from AGENTS.md)

- **TypeScript strict**: `unknown` at boundaries, parsed into named types. No `as` casts, no `any`.
- **No new dependencies** for things under 100 lines (inline it instead).
- **Pure black UI**, system font, one accent (if you touch UI, match existing components).
- **Streaming text** goes through `app/src/store/text.ts` (rAF-coalesced, per-reply subscriptions). Never put per-token updates in the chats store.

## How to Contribute

Read [CONTRIBUTING.md](../../../CONTRIBUTING.md) for the full guide. Quick summary:

1. **Search issues/PRs first** to avoid duplicate work.
2. **Open a discussion** for large changes (new harnesses, protocol changes).
3. **Respect ownership**: Don't edit `app/` files unless assigned.
4. **Branch and PR**: `python3 .verified-oss-loop/rollout.py show`. Branch from `nightly`, open a day-pass PR at `preview` (overnight at `nightly`). Do not pile PRs onto `main`.
5. **Fail-then-pass proof**: Show the bug/gap, then fix it. Include tests or examples. Read `.cursor/skills/tdd/SKILL.md`. Run `bun scripts/mutate.ts` if you touched a mutate target.

## What NOT to Do

- Do not edit `app/src/**`, `app/App.tsx`, `app/app.json`, `app/metro.config.js` (owned by Kevin).
- Do not mark Linear issues "Done" from this repo (Linear is separate).
- Do not unlock `keel` for production (keel is internal scaffolding, not ready).
- Do not commit secrets (tokens, keys, credentials) in code or chat.
- Do not force-push to `main` or rewrite shared history.
- Do not merge `main` or `dev`. Channel automerge is only for `preview`/`nightly`.

## Next Steps

- If working on **bridge or protocol changes**, read `.cursor/skills/dash-bridge/SKILL.md`.
- If pairing, roster, hello, or attach is broken, read `.cursor/skills/dash-debug/SKILL.md`.
- If opening a PR, read `.cursor/skills/dash-contribute/SKILL.md` for PR hygiene.
- If adding a new harness, study `bridge/src/harnesses.ts` for adapter patterns.
- If writing docs or skills, follow the existing structure (short, clear, actionable).

## Vision

Dash is building a **personalized compute mesh**: phone + laptop + edge as unified compute, with Tailscale as the fabric and agents as the intelligence layer.

**Naming note:** Dash phone pair/pairing = Expo ↔ laptop (Tailscale port 4747). NVIDIA PAIR = Personal-AI-Router (separate mesh product, not phone pairing).

**Current priorities:**

1. Bridge stability (reliable WebSocket across network changes, screen locks).
2. Harness coverage (support all major coding agents).
3. Community tooling (skills, docs, examples).
4. Mesh primitives (Tailscale integration, multi-machine orchestration).

**Not yet:**

- Production deployment of `keel` or backend services.
- Native modules outside Expo SDK (must run in Expo Go).
- UI polish (Kevin is actively iterating).

## Questions?

Open a discussion or issue in the repo. See [CONTRIBUTING.md](../../../CONTRIBUTING.md) for details.
