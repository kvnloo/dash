# GitHub Loop Automation

This document explains the automated workflows that maintain repository hygiene for kvnloo/dash.

## Overview

Dash uses a minimal set of GitHub Actions to keep the loop healthy:

- **Auto-labeling** — tags PRs by affected area
- **Stale management** — reminds contributors about inactive issues/PRs
- **PR checklist reminder** — lightweight contributor guide
- **CI** — basic typecheck and lint validation (non-blocking during early development)

## Workflows

### 1. Auto-label PRs (`.github/workflows/labeler.yml`)

**When:** On PR open or update  
**What:** Applies labels based on file paths changed

**Labels applied:**
- `area:app` — changes to `app/**`
- `area:bridge` — changes to `bridge/**`
- `area:shared` — changes to `shared/**`
- `area:docs` — changes to `docs/**`, `*.md`
- `area:loop` — changes to `.github/**`

**Configuration:** `.github/labeler.yml`

**Extending:**
- Add new path patterns to `.github/labeler.yml`
- Create corresponding labels in GitHub (Settings → Labels)

### 2. Stale Issues & PRs (`.github/workflows/stale.yml`)

**When:** Daily at midnight UTC (or manual trigger)  
**What:** Marks inactive issues/PRs as stale, closes after grace period

**Behavior:**
- **Issues:** 60 days inactive → marked stale → closed after 14 days
- **PRs:** 30 days inactive → marked stale → closed after 7 days

**Exempt labels:**
- `priority:P0`, `priority:P1` — critical/urgent work
- `good-first-issue` — community onboarding
- `work-in-progress` — active long-term work
- `pinned` — persistent reference issues

**Manual override:** Comment on a stale issue/PR to keep it open.

### 3. PR Checklist Reminder (`.github/workflows/pr-checklist.yml`)

**When:** When a PR is opened  
**What:** Checks if PR description includes key checklist items from the template

**Checks for:**
- "Ownership respected" — AGENTS.md boundaries followed
- "Mode:" — unattended vs copilot contribution
- Checkbox syntax (`- [`)

**If missing:** Posts a friendly comment linking to the PR template.

**Why:** Lightweight alternative to requiring strict PR format; educates contributors without blocking.

### 4. CI (`.github/workflows/ci.yml`)

**When:** On PR to `main` or push to `main`  
**What:** Runs typecheck and lint (non-blocking early in development)

**Jobs:**
- **typecheck-and-lint** — runs `tsc --noEmit` and `bun run lint` (if exists) for app, bridge, server
- **install-root** — validates root install + checks `shared/protocol.ts` exists

**Note:** Checks are `continue-on-error: true` to avoid blocking during rapid iteration. Tighten this later.

## Recommended Labels

Create these labels in GitHub (Settings → Labels) for the automation to work:

### Area labels
- `area:app` — Expo UI (app/src/**, app/App.tsx)
- `area:bridge` — WebSocket server + harness adapters
- `area:shared` — Protocol (shared/protocol.ts)
- `area:docs` — Documentation
- `area:loop` — GitHub automation

### Priority labels
- `priority:P0` — Critical (blocks release, production down)
- `priority:P1` — High (major bug, important feature)
- `priority:P2` — Medium (nice-to-have, minor bug)
- `priority:P3` — Low (polish, future work)

### Workflow labels
- `good-first-issue` — Beginner-friendly
- `needs-discussion` — Requires design/architecture discussion
- `work-in-progress` — Long-term active work
- `pinned` — Persistent reference (roadmap, FAQ)
- `stale` — Auto-applied by stale workflow

### Mode labels
- `mode:unattended` — Cloud agent / autonomous contribution
- `mode:copilot` — Human-supervised contribution

## Extending the Loop

### Adding a new workflow

1. Create `.github/workflows/<name>.yml`
2. Use `GITHUB_TOKEN` (available by default, no secrets needed)
3. Document behavior in this file
4. Test with `workflow_dispatch:` trigger before enabling on push/PR

### Adding a new label

1. Go to Settings → Labels → New Label
2. Add to `.github/labeler.yml` if path-based
3. Update this doc with label purpose

### Customizing stale timing

Edit `.github/workflows/stale.yml`:
- `days-before-issue-stale` / `days-before-pr-stale` — inactivity threshold
- `days-before-issue-close` / `days-before-pr-close` — grace period after stale
- `exempt-issue-labels` / `exempt-pr-labels` — labels that prevent stale

## No Secrets Required

All workflows use `GITHUB_TOKEN` (auto-provided by GitHub Actions). No additional secrets needed.

## Maintenance Notes

- **Workflow run history:** Actions → Workflows → [workflow name]
- **Disable a workflow:** Edit `.github/workflows/<name>.yml` and remove `on:` triggers (or delete file)
- **Manual run:** Actions → [workflow name] → Run workflow (if `workflow_dispatch` enabled)

## Philosophy

Keep the loop **few and maintainable**:
- Prefer education over enforcement (lightweight reminders vs blocking CI)
- Automate only what saves toil (labeling, stale hygiene, contributor guidance)
- Avoid heavy test matrices, secret-dependent workflows, or keel-language steps
- When in doubt, document the process rather than automating it
