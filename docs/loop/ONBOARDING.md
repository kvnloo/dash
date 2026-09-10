# Onboarding: Use vs Contribute

This page helps you decide how to engage with Dash based on your goals.

## Use Dash

**Goal:** Try the phone app and chat with agents on your laptop.

**You are here if:**

- You want to use Dash as an end-user (chat with agents from your phone).
- You're curious how it works but not planning to contribute code yet.
- You want to run the bridge and app locally for your own workflows.

**Start here:**

1. Read the [README](../../README.md) for quick start instructions.
2. Follow the setup:
   - Start the bridge on your laptop: `cd bridge && bun install && bun run index.ts`
   - Start the app: `cd app && bun install && bunx expo install && bunx expo start`
   - Pair your phone (Expo Go) with the bridge via Tailscale.
3. Chat with agents (OMP, Codex, Grok, Hermes, Claude Code).

**No code changes needed.** Just run and use.

## Contribute to Dash

**Goal:** Help build Dash by contributing code, docs, or compute.

**You are here if:**

- You want to add features, fix bugs, or improve docs.
- You're a coding agent and your human asked you to contribute to this repo.
- You want to donate compute (run the bridge as part of the mesh).

**Choose your contribution style:**

### 1. Unattended (Donate Compute)

Run the bridge and leave agents working. Your laptop becomes part of the mesh (future: agents can spawn sub-agents on available machines via Tailscale).

**How:**

```bash
cd bridge && bun run index.ts
# Leave it running (systemd, launchd, supervisor, or just a long-lived terminal).
```

**No code changes required.** Just availability.

**Recommended if:**

- You have spare compute (laptop, desktop, edge instance).
- You're comfortable running the bridge 24/7 or during specific hours.
- You want to support the community without writing code.

### 2. Copilot (Paired Human+Agent on a Scoped PR)

Contribute code, docs, or skills by pairing with an agent on a focused branch.

**How:**

1. **Search issues and PRs first** to avoid duplicate work.
2. **Open a discussion** for large changes (new harnesses, protocol changes, major features).
3. **Respect ownership** (see [AGENTS.md](../../AGENTS.md)):
   - `app/src/**`, `app/App.tsx`, `app/app.json`, `app/metro.config.js`: owned by the UI session (Kevin). Do not edit unless assigned.
   - `bridge/**`, `shared/protocol.ts`: owned by the bridge session. Coordinate with maintainers.
   - Docs, skills, examples, tests: open to all contributors.
4. **Fork or branch** from `main`, work in focused commits, open a PR early (draft is fine).
5. **Fail-then-pass proof** (preferred): Show the bug/gap with a failing test or log, then fix it and show it passing.

**See [CONTRIBUTING.md](../../CONTRIBUTING.md) for full details.**

**Recommended if:**

- You're a developer (human or agent) with a specific fix or feature in mind.
- You want to improve docs, add skills, or write examples.
- You're comfortable with git, PRs, and code review.

## Decision Tree

```
Are you planning to write code, docs, or skills?
│
├─ No → Use Dash (README quick start)
│
└─ Yes → Contribute to Dash
    │
    ├─ I just want to donate compute → Unattended (run the bridge 24/7)
    │
    └─ I have a specific feature/fix/doc to contribute → Copilot (fork, branch, PR)
```

## Next Steps

- **For users:** See the [README](../../README.md) and [AGENTS.md](../../AGENTS.md) (layout and conventions).
- **For unattended contributors:** Run the bridge and keep it up. Future: register your machine in the mesh directory (not yet implemented).
- **For copilot contributors:** Read [CONTRIBUTING.md](../../CONTRIBUTING.md) and `.cursor/skills/dash-onboard/SKILL.md` (for agents).

## Questions?

Open a discussion or issue in the repo. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for details.
