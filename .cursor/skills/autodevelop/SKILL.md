---
name: autodevelop
description: Start contributing to Dash from any harness. Use when the human says autodevelop, donate a coding pass, or pick the next claimable issue.
---

# Autodevelop Dash

You are a contributor, not a maintainer. This skill is the whole loop. Do not invent a parallel process.

## First 60 seconds

1. Read `AGENTS.md`, then `.cursor/skills/dash-onboard/SKILL.md`.
2. `git fetch origin` and work from `origin/main` unless the issue names another branch.
3. Search open issues and PRs. Do not duplicate in-flight work.

```bash
gh issue list --repo kvnloo/dash --label claimable --state open
gh pr list --repo kvnloo/dash --state open
```

## Pick work

Take **one** open issue labeled `claimable` and not `claimed`. Prefer `priority:P0` then `P1`, then `good-first-issue`. Skip `needs-discussion` unless the human assigned it.

If nothing is claimable: stop. Comment on the newest `needs-discussion` issue with a one-paragraph proposal. Do not start coding.

## Claim (lease)

Comment on the issue, then add `claimed` and remove `claimable`:

```text
claiming for autodevelop
claimant: <github login or agent id>
base: <git rev-parse origin/main>
expires: <now + 24h UTC>
scope: <one sentence>
```

If a claim comment newer than 24h exists, pick a different issue.

## Build in isolation

```bash
git fetch origin
git switch -c issue/<N>-<slug> origin/main
```

Do not edit the integration checkout (`integrate/device-layer`) unless you are the integration owner. Feature worktrees live under `.worktrees/` when that map in `docs/orchestration.md` applies.

Ownership (`AGENTS.md`):

- Do **not** edit `app/src/**`, `app/App.tsx`, `app/app.json`, `app/metro.config.js` unless the issue assigns UI work.
- `bridge/**` and `shared/protocol.ts`: coordinate; keep protocol backward compatible.
- Docs, skills, tests, `.github/**`: open.

## Fail, then pass

Show the gap, then the fix. Read `.cursor/skills/tdd/SKILL.md`.

```bash
bun install --cwd app && bun install --cwd bridge
bun test app/src bridge/src shared
```

If you touched `golden-nav.ts`, `bridge-pull.ts`, `motion.ts`, `shared/protocol.ts`, or `bridge/src/roster.ts`:

```bash
bun scripts/mutate.ts --file <path>
```

Score must stay ≥ 80. A surviving mutant is a missing assertion.

Phone / pairing proofs use `.cursor/skills/verify-dash` and `bun scripts/verify-dash/control-dash.ts`. Never start a second `dash-pair` or Metro on 8097.

## Open a PR, never merge

Push the branch, open a PR against `main`, fill `.github/PULL_REQUEST_TEMPLATE.md`. Evidence in the PR body:

- issue number
- base SHA and head SHA
- red command + failure, green command + pass
- what you did **not** verify (device, Tailscale, a harness)

Workers never merge, never force-push `main`, never mark Linear Done, never commit secrets.

## Stop conditions

Stop and report if: ownership blocks the change, a competing PR covers the scope, tests need a live phone you do not have, or the claim expired.
