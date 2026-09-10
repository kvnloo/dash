# Dash Contribute

**When to use:** Opening a PR, reviewing code, or contributing to the Dash repo. Read this skill for PR hygiene, discussion protocols, and community norms.

## Before Opening a PR

1. **Search issues and PRs first.** Check if someone is already working on your idea or if there's an open discussion.
2. **Open a discussion for large changes.** New harnesses, protocol changes, or major features should have community input before implementation.
3. **Respect ownership.** See [AGENTS.md](../../AGENTS.md):
   - `app/src/**`, `app/App.tsx`, `app/app.json`, `app/metro.config.js`: **UI session** (Kevin). Do not edit unless assigned.
   - `bridge/**`, `shared/protocol.ts`: **Bridge session**. Coordinate with bridge maintainers.
   - Docs, skills, examples, tests: Open to all contributors.

## Opening a PR

**Good PR practices:**

- **Focus**: One logical change per PR. Avoid bundling unrelated fixes.
- **Title**: Clear and descriptive (e.g., "Add support for Codex streaming", "Fix WebSocket reconnect on iOS").
- **Description**: Explain *why* the change is needed, not just *what* changed. Include:
  - Problem statement or motivation.
  - Approach (how you solved it).
  - Before/after examples (for behavior changes).
  - Test plan or proof (see below).
- **Draft early**: Open a draft PR to signal work-in-progress and get early feedback.
- **Small commits**: One logical change per commit. Meaningful commit messages (not "wip" or "fix").

## PR Proof Style: Fail-then-Pass

**Preferred proof:**

1. Show the bug or gap (failing test, error log, or reproduction steps).
2. Apply your fix.
3. Show the test passing or the bug resolved.

**Example (test-driven):**

```bash
# Before fix
$ bun test bridge.test.ts
✗ should reconnect and replay events (failed)

# After fix
$ bun test bridge.test.ts
✓ should reconnect and replay events (passed)
```

**Example (manual verification):**

```
Before: WebSocket drops on iOS screen lock, events are lost.
After: Client sends `attach` on reconnect, bridge replays events from last seen seq.
Test: Lock screen → unlock → verify chat history is complete.
```

**Not required for:**

- Docs-only changes.
- Trivial typo fixes.
- Adding examples or skills (but include usage instructions).

## PR Labels

(No automated labeling yet; maintainers will tag PRs manually.)

Suggested labels:

- `bridge` — Bridge or protocol changes.
- `harness` — New harness or adapter changes.
- `docs` — Documentation or skills.
- `bug` — Bug fix.
- `enhancement` — New feature or improvement.
- `breaking` — Breaking change (requires coordination).

## Review Process

1. **Maintainers review** within 1–3 days (best effort; community project).
2. **Iterate on feedback.** Address review comments in new commits (don't force-push during review).
3. **Approval and merge.** Once approved, a maintainer will merge (squash or rebase, depending on commit quality).

## Testing

**Manual testing:**

- For bridge changes: Test with at least one harness (OMP recommended).
- For protocol changes: Test with the phone app (Expo Go) and multiple harnesses.
- For harness adapters: Test with the actual CLI (check `Bun.which(bin)`).

**Automated testing:**

- Unit: `bun test app/src bridge/src shared` (or `bun test` at the repo root).
- Mutation: `bun scripts/mutate.ts` — score ≥ 80. Surviving mutants are missing assertions, not a reason to skip.
- Runtime: `bun scripts/verify-dash/control-dash.ts doctor`.
- Device: Maestro flows in `.maestro/` (phone required).

TDD skill: `.cursor/skills/tdd/SKILL.md`. Fail, then pass. Pin UI geometry; do not test mocks of Reanimated.

## Working with Agents

Dash is built for human+agent collaboration. If you're an agent reading this:

- **Read [AGENTS.md](../../AGENTS.md)** for ownership rules (do not edit `app/` files unless assigned).
- **Read `.cursor/skills/dash-onboard/SKILL.md`** for repo layout and conventions.
- **Keep skills short and actionable.** Each skill should be <200 lines, with a clear "when to use" description.
- **Avoid over-engineering.** Inline code under 100 lines instead of adding dependencies.
- **TypeScript strict.** Parse `unknown` at boundaries; no `as` casts, no `any`.

## What NOT to Contribute

- **Linear issues.** Do not mark Linear issues "Done" from this repo (Linear is managed separately).
- **Keel production unlock.** Keel is internal scaffolding and not ready for deployment. Do not enable production mode.
- **Secrets in code.** Never commit tokens, API keys, or credentials. Use `~/.dash/token` or environment variables.
- **Force-push to main.** Do not rewrite shared history. Rebase your branch before merging, but never force-push `main`.
- **UI changes (for now).** Kevin is actively iterating on `app/src/**`. Coordinate before editing app UI files.

## Examples of Good PRs

**Example 1: Add a new harness**

- PR title: "Add support for Aider agent"
- Description: "Aider is a coding agent with JSON output. This PR adds an adapter following the OMP pattern."
- Proof: Include a sample conversation log showing `session`, `delta`, `done` events.
- Changes: Add harness definition to `bridge/index.ts`, update `README.md` with Aider install instructions.

**Example 2: Fix a bug**

- PR title: "Fix: WebSocket reconnect loses events on slow network"
- Description: "When network latency is high, the client reattaches before the server finishes processing the previous turn. This PR adds a retry mechanism."
- Proof: Before/after logs showing events lost → events replayed correctly.
- Changes: Update `attach` handler in `bridge/index.ts`, add retry logic in `app/src/store/...` (read-only example; do not edit app unless assigned).

**Example 3: Add a skill**

- PR title: "Add skill: dash-debug (debugging the bridge)"
- Description: "This skill teaches agents how to debug bridge issues (logs, process inspection, WebSocket tracing)."
- Proof: No formal proof needed; include example usage.
- Changes: Create `.cursor/skills/dash-debug/SKILL.md`.

## Issue Priorities

See [docs/loop/ISSUE_PRIORITY.md](../../docs/loop/ISSUE_PRIORITY.md) for the current priority rubric (impact vs effort toward the mesh vision).

**High-priority themes:**

- Bridge stability (reconnect, session management, harness reliability).
- Harness coverage (support all major coding agents).
- Community tooling (skills, docs, examples for agents).
- Mesh primitives (Tailscale integration, multi-machine orchestration).

**Low-priority (for now):**

- Production deployment (keel backend, hosting).
- Native modules outside Expo SDK.
- UI polish (Kevin is actively iterating).

## Questions?

Open a discussion or issue in the repo. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for details.
