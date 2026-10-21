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

### Opt-in inline generative UI

Dash renders Mermaid flowcharts/state diagrams, images, declarative components and
static HTML directly in ordinary Hermes/omp reply Markdown. No command or live-mode
switch is needed to render a reply that contains these blocks. See
`.cursor/skills/dash-genui/SKILL.md` for the exact catalog and examples.

Agent emission is opt-in, not globally enabled by this PR:

- Hermes: copy `.cursor/skills/dash-genui/` into the chosen profile's
  `$HERMES_HOME/skills/dash-genui/` (for Kevin's clean profile, explicitly
  `/home/kvn/.hermes/profiles/clean/skills/dash-genui/`). Start a new session and
  ask “Load dash-genui and use inline UI when useful for this conversation.”
  Do not copy into other profiles or edit AGENTS.md. A discovered skill is not a
  promise it has been loaded; explicitly loading it opts in for the conversation.
- OMP: start the selected OMP session with
  `omp --append-system-prompt /absolute/path/to/dash/docs/genui/omp-system-prompt.md`.
  This flag was verified with the installed OMP help. Keep it in that profile's
  launcher only if you want it on each session; no launcher/profile is changed here.

Use `mermaid`, `genui` (or `openui` JSON alias), and `html` fenced blocks;
`![description](https://host/image.png)` or an absolute shared host image path
renders a thumbnail. Tap to expand; pinch or use zoom/reset. Mermaid uses locally
bundled @xyflow/react + Dagre through Expo DOM (Expo Go's WebView), no CDN.
Unsupported Mermaid syntax and invalid specs remain copyable source. `openui`
does not evaluate the legacy OpenUI language or claim `.hvisual.json` compatibility.

Choice taps are source-turn-owned LiveIntents. Existing libfx workers retain their
live_intent receipt channel; ordinary Hermes and omp receive the same validated
intent as a visible user turn in the original session. Busy/offline/stale targets
refuse the tap with visible feedback. This is never an approval or tool-execution API.

Model HTML gets a restrictive CSP (no scripts, forms, network or embedding); stage
expansion is an unverified local preview, not a publication. Component data is a
bounded catalog with no evaluator. Remote image hosts see the client's request;
use trusted URLs. Local images use authenticated `GET /files?path=...`, existing
share roots/hidden-secret restrictions, byte sniffing, and a 12 MiB limit. Tokens
stay in headers, never model HTML or URLs. Local paths refer to the paired bridge,
not an arbitrary remote harness host. Use a reachable URL for remote-host images.

Verification (host only; never touch the owner's phone):

    bun test app/src bridge/src shared
    bun app/node_modules/typescript/bin/tsc -p app --noEmit
    cd app && EXPO_PUBLIC_DEBUG=1 bunx expo export --platform web && cd ..
    node scripts/genui-qualify.mjs

The last command owns an ephemeral loopback HTTP port and isolated headless
Chromium at 412×915 with touch emulation. It tests actual Markdown-rendered chat
fixtures, node taps/zoom, image pinch, cards/table/choices, checklist/timeline,
script blocking, stage expansion and readable fallback. Override `GENUI_WEB_DIR`
and `GENUI_REPORT_DIR` to keep the web export and screenshots outside the repo.
These fixtures do not claim a real model turn or native-device acceptance.

### Autodevelop (agents)

If you are a coding agent told to **autodevelop**, read
[`.cursor/skills/autodevelop/SKILL.md`](.cursor/skills/autodevelop/SKILL.md)
and run that loop. Dash follows the [Verified OSS Loop](https://github.com/kvnloo/verified-oss-loop)
with scheme **rolling**. Claim one `claimable` issue, `python3 .verified-oss-loop/rollout.py show`,
branch from `origin/nightly`, prove fail-then-pass, open a PR at `preview`
(day) or `nightly` (overnight). Do not merge `main` or `dev`.


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

Answer the concrete surface and feedback checklist in [Design principles](docs/design/PRINCIPLES.md) for every Dash PR that changes an interaction. Name unavailable telemetry instead of implying that the accept/reject learning pipeline already exists.

1. Fork or branch from `nightly` (`worker_base`). Day-pass PRs target `preview`. Overnight PRs target `nightly`. Do not pile PRs onto `main`.
2. Work in small, focused commits.
3. Write or update tests if applicable. Fill the evidence receipt in `.github/PULL_REQUEST_TEMPLATE.md`.
4. Open a PR early (draft is fine) with a clear title and description. Automerge into `preview`/`nightly` waits for checks; it never merges `main`/`dev`.
5. Request review from maintainers or relevant domain owners.
6. Iterate based on feedback.

**Preferred proof style:**

- **Fail-then-pass**: Show the bug/gap with a failing test, then fix it and show the test passing. Skill: `.cursor/skills/tdd/SKILL.md`.
- Include before/after examples when changing behavior.
- For contract files (`golden-nav.ts`, `bridge-pull.ts`, `motion.ts`, `shared/protocol.ts`, `bridge/src/roster.ts`), run `bun scripts/mutate.ts --file <path>` and keep the mutation score ≥ 80.
- For new features, include usage examples or integration tests.

### Working with Agents

Dash is designed for human+agent collaboration. When contributing:

- **Agent skills live in `.cursor/skills/`** (see [skills directory](.cursor/skills/)). Each skill is a short `SKILL.md` with a "when to use" description and a recipe. Agents read these to learn the repo. Pairing, roster, and attach failures: `.cursor/skills/dash-debug/SKILL.md`.
- **Agent-friendly commits**: Clear commit messages, one logical change per commit, and references to issues/discussions.
- **Harness patterns**: Each harness (omp, codex, grok, claude, hermes) has its own CLI and output format. When adding harness support, see [`bridge/src/harnesses.ts`](bridge/src/harnesses.ts) for examples.

**First-run agents**: If you're an agent reading this for the first time, load the `.cursor/skills/dash-onboard` skill to understand the repo layout and conventions.

## What NOT to Do

- **Do not** mark Linear issues "Done" from this repo. Linear is managed separately.
- **Do not** unlock `keel` for production use. Keel is internal scaffolding and not ready for deployment.
- **Do not** commit secrets (tokens, API keys, credentials) in code or chat logs. Use `~/.dash/token` or environment variables.
- **Do not** force-push to `main` or rewrite shared history.
- **Do not** merge `main` or `dev`. Channel automerge is only for `preview`/`nightly`.
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

## Naming / Glossary

To avoid confusion between similar terms:

- **Dash phone pair/pairing**: The Expo app connecting to your laptop bridge over Tailscale (port 4747, token or sonic pairing). This is Dash-specific: your phone as a control surface for agents running on your laptop.
- **NVIDIA PAIR** (Personal-AI-Router): A separate, first-class mesh routing product for home inference across devices. Not related to Dash phone pairing. NVIDIA PAIR is a mesh compute library alongside Tailscale, part of the broader mesh primitives vision.

Use lowercase "pair" or "pairing" when referring to the phone+laptop workflow. Use "NVIDIA PAIR" (uppercase) for the Personal-AI-Router mesh product.

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
