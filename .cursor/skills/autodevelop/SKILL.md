---
name: autodevelop
description: Start contributing to Dash from any harness. Use when the human says autodevelop, donate a coding pass, or pick the next claimable issue.
---

# Autodevelop Dash

You are a contributor, not a maintainer. This skill is the whole loop. Do not invent a parallel process. Protocol: [Verified OSS Loop](https://github.com/kvnloo/verified-oss-loop).

## First 60 seconds

1. Read `AGENTS.md`, then `.cursor/skills/dash-onboard/SKILL.md`.
2. `git fetch origin`. `python3 .verified-oss-loop/rollout.py show`. Branch from `origin/$(python3 .verified-oss-loop/rollout.py get worker_base)` unless the issue names another base. Day-pass PRs target `feature_target` (`preview`). Overnight unattended PRs target `overnight_target` (`nightly`).
3. Search open issues and PRs. Do not duplicate in-flight work. Stop if a competing PR or overnight branch already covers the scope.

```bash
gh issue list --repo kvnloo/dash --label claimable --state open
gh pr list --repo kvnloo/dash --state open
python3 .verified-oss-loop/rollout.py show
```

## Pick work

Take **one** open issue labeled `claimable` and not `claimed`. Prefer `priority:P0` then `P1`, then `good-first-issue`. Skip `needs-discussion` unless the human assigned it.

If nothing is claimable: stop. Comment on the newest `needs-discussion` issue with a one-paragraph proposal. Do not start coding. Do not open a consolation PR at `main`.

## Claim (lease)

Comment on the issue, then add `claimed` and remove `claimable`:

```text
claiming for autodevelop
claimant: <github login or agent id>
base: <git rev-parse origin/$(python3 .verified-oss-loop/rollout.py get worker_base)>
expires: <now + 24h UTC>
scope: <one sentence>
```

If a claim comment newer than 24h exists, pick a different issue.

## Build in isolation

```bash
git fetch origin
git switch -c issue/<N>-<slug> origin/$(python3 .verified-oss-loop/rollout.py get worker_base)
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

Score must stay ≥ 80. A surviving mutant is a missing assertion. Do not run Stryker.

Phone / pairing proofs use `.cursor/skills/verify-dash` and `bun scripts/verify-dash/control-dash.ts`. Never start a second `dash-pair` or Metro on 8097.

## Open a PR, never merge

Push the branch. Open the PR at `feature_target` (day) or `overnight_target` (overnight). Fill `.github/PULL_REQUEST_TEMPLATE.md` including the YAML receipt. Bind `head_revision` to this PR's SHA.

Workers never merge `main` or `dev`, never force-push `main`, never mark Linear Done, never commit secrets. Do not merge `preview`/`nightly` yourself; channel automerge may, after checks, when `rollout.yml` allows.

## Stop conditions

Stop and report if: ownership blocks the change, a competing PR covers the scope, tests need a live phone you do not have, or the claim expired.
