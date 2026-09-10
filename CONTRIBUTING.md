# Contributing to Dash

Dash is an AI-native project built by humans and coding agents working together over Tailscale. This guide explains how to **use** Dash and how to **contribute** to it.

## Using Dash

Dash is a phone app (Expo) that connects to coding agents running on your laptop. To try it:

1. **Start the bridge** on your laptop (inside the repo):
   ```bash
   cd bridge && bun install && bun run index.ts
   ```
   The bridge listens on your Tailscale network at port `4747` and prints your pairing code.

2. **Launch the app** (in a separate terminal):
   ```bash
   cd app && bun install && bunx expo install
   bunx expo start
   ```
   Scan the QR code with Expo Go (Android/iOS).

3. **Pair your phone**: In the app, go to Settings → Pair with your laptop. Enter your Tailscale address and token (from `~/.dash/token`), or use sonic pairing (phone listens, laptop plays a code).

4. **Chat**: Tap a harness (OMP, Codex, Grok, Hermes, Claude Code) and start a conversation. Your agents run on your laptop; the phone is a control surface.

See the [README](README.md) for more details.

## Contributing to Dash

### Autodevelop (agents)

If you are a coding agent told to **autodevelop**, read
[`.cursor/skills/autodevelop/SKILL.md`](.cursor/skills/autodevelop/SKILL.md)
and run that loop. Claim one `claimable` issue, work on a branch from
`origin/main`, prove fail-then-pass, open a PR. Do not merge `main`.


Contributions come in two flavors: **unattended** and **copilot**.

### Unattended: Donate Compute

Run the bridge and leave agents working. Your laptop becomes part of the mesh:

- Agents can spawn sub-agents on available machines via Tailscale.
- Bridge uptime = more capacity for the community.
- No code changes required; just availability.

**How to run unattended:**

```bash
cd bridge && bun run index.ts
# Leave it running. Check logs in the terminal or systemd/launchd/supervisor.
```

### Copilot: Paired Human+Agent on a Scoped PR

Contribute code, docs, or skills by pairing with an agent on a focused branch. This is the primary contribution workflow.

**Before starting:**

1. **Search issues and PRs first**. Someone may already be working on your idea.
2. **Open a discussion** for large changes (new harnesses, protocol changes, major features). Small fixes and docs don't need discussion.
3. **Respect ownership** (see [AGENTS.md](AGENTS.md)):
   - `app/src/**`, `app/App.tsx`, `app/app.json`, `app/metro.config.js`: owned by the UI session. Do not edit these files unless you are explicitly assigned UI work.
   - `bridge/**`, `shared/protocol.ts`: owned by the bridge session.
   - Anyone can add docs, skills, examples, and tests.

**PR workflow:**

1. Fork or branch from `main`.
2. Work in small, focused commits.
3. Write or update tests if applicable.
4. Open a PR early (draft is fine) with a clear title and description.
5. Request review from maintainers or relevant domain owners.
6. Iterate based on feedback.

**Preferred proof style:**

- **Fail-then-pass**: Show the bug/gap with a failing test, then fix it and show the test passing. Skill: `.cursor/skills/tdd/SKILL.md`.
- Include before/after examples when changing behavior.
- For contract files (`golden-nav.ts`, `bridge-pull.ts`, `motion.ts`, `shared/protocol.ts`, `bridge/src/roster.ts`), run `bun scripts/mutate.ts --file <path>` and keep the mutation score ≥ 80.
- For new features, include usage examples or integration tests.

### Working with Agents

Dash is designed for human+agent collaboration. When contributing:

- **Agent skills live in `.cursor/skills/`** (see [skills directory](.cursor/skills/)). Each skill is a short `SKILL.md` with a "when to use" description and a recipe. Agents read these to learn the repo.
- **Agent-friendly commits**: Clear commit messages, one logical change per commit, and references to issues/discussions.
- **Harness patterns**: Each harness (omp, codex, grok, claude, hermes) has its own CLI and output format. When adding harness support, see [`bridge/src/harnesses.ts`](bridge/src/harnesses.ts) for examples.

**First-run agents**: If you're an agent reading this for the first time, load the `.cursor/skills/dash-onboard` skill to understand the repo layout and conventions.

## What NOT to Do

- **Do not** mark Linear issues "Done" from this repo. Linear is managed separately.
- **Do not** unlock `keel` for production use. Keel is internal scaffolding and not ready for deployment.
- **Do not** commit secrets (tokens, API keys, credentials) in code or chat logs. Use `~/.dash/token` or environment variables.
- **Do not** force-push to `main` or rewrite shared history.
- **Do not** change `app/src/**`, `app/App.tsx`, `app/app.json`, or `app/metro.config.js` unless explicitly assigned. These files are owned by the UI session (Kevin) and are mid-flight.

## Priorities and Vision

Dash is building a **personalized compute mesh**: your phone + laptop + edge instances as a unified compute surface, with Tailscale as the network fabric and agents as the intelligence layer.

**Current priorities:**

1. **Bridge stability**: Keep the WebSocket bridge reliable across network changes, screen locks, and harness failures.
2. **Harness coverage**: Support all major coding agents (OMP, Codex, Grok, Hermes, Claude Code) with clean, streaming output.
3. **Community tooling**: Skills, docs, and examples that make it easy for agents to contribute cleanly.
4. **Mesh primitives**: Tailscale integration, multi-machine orchestration, and edge compute (not yet unlocked).

**Non-priorities** (for now):

- Production deployment of `keel` or any backend services.
- Native modules outside the Expo SDK (must run in Expo Go).
- UI polish (Kevin is actively iterating on the app UI).

## Architecture Recap

- **`app/`**: Expo app (React Native). All UI in `app/src/`. Runs in Expo Go.
- **`bridge/`**: Bun WebSocket server. Entry: `bridge/index.ts`. Harness adapters: `bridge/src/harnesses.ts`.
- **`shared/protocol.ts`**: Wire protocol (dependency-free; imported by both app and bridge).
- **`.cursor/skills/`**: Agent skills (short `SKILL.md` files teaching agents how to work with this repo).
- **`docs/loop/`**: Community development loop documentation.

See [AGENTS.md](AGENTS.md) for multi-agent ownership rules.

## Questions?

- Open a discussion in the repo for feature ideas or architecture questions.
- For bugs, open an issue with reproduction steps.
- For quick help, ask in the community chat (link TBD).

Thank you for contributing to Dash!
