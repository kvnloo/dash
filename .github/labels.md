# Recommended Labels

This document lists the labels used by dash's GitHub automation. Create these in **Settings → Labels**.

## Area Labels

Applied automatically by `.github/workflows/labeler.yml`:

- **area:app** (#0366d6) — Expo UI (app/src/**, app/App.tsx, app/app.json, app/metro.config.js)
- **area:bridge** (#0366d6) — Bun WebSocket server + harness adapters (bridge/**)
- **area:shared** (#0366d6) — Wire protocol (shared/protocol.ts)
- **area:docs** (#0366d6) — Documentation (docs/**, *.md, AGENTS.md, README.md)
- **area:loop** (#0366d6) — GitHub automation (.github/**)
- **area:verify** (#5319e7) — TDD, unit tests, mutation (`scripts/mutate.ts`, `*.test.ts`)

## Priority Labels

For manual triage:

- **priority:P0** (#d73a4a) — Critical (blocks release, production down)
- **priority:P1** (#e99695) — High (major bug, important feature)
- **priority:P2** (#f9d0c4) — Medium (nice-to-have, minor bug)
- **priority:P3** (#fef2c0) — Low (polish, future work)

## Workflow Labels

- **good-first-issue** (#7057ff) — Beginner-friendly, good for new contributors
- **needs-discussion** (#d876e3) — Requires design/architecture discussion before work
- **work-in-progress** (#fbca04) — Long-term active work (exempted from stale bot)
- **pinned** (#0e8a16) — Persistent reference (roadmap, FAQ, exempted from stale bot)
- **claimable** (#0e8a16) — Ready for autodevelop; no active lease
- **claimed** (#fbca04) — An agent or human holds a 24h lease
- **needs-review** (#1d76db) — PR or issue waiting on independent review
- **stale** (#eeeeee) — Auto-applied by stale workflow (60d issues, 30d PRs)


## Mode Labels

For tracking contribution type:

- **mode:unattended** (#c5def5) — Cloud agent / autonomous run (donated compute)
- **mode:copilot** (#bfdadc) — Human-supervised contribution

## Type Labels

Default GitHub labels, useful for issues:

- **bug** (#d73a4a) — Something isn't working
- **enhancement** (#a2eeef) — New feature or request
- **discussion** (#cc317c) — Ideas, setup help, open-ended questions

## Creating Labels

### Option 1: Manual Creation

1. Go to **Settings → Labels**
2. Click **New Label**
3. Copy name and color from list above

### Option 2: GitHub CLI Script

Run this script from the repo root (requires `gh` CLI):

```bash
#!/bin/bash
# Create labels for kvnloo/dash

gh label create "area:app" --color 0366d6 --description "Expo UI" || true
gh label create "area:bridge" --color 0366d6 --description "Bridge server + harnesses" || true
gh label create "area:shared" --color 0366d6 --description "Wire protocol" || true
gh label create "area:docs" --color 0366d6 --description "Documentation" || true
gh label create "area:loop" --color 0366d6 --description "GitHub automation" || true
gh label create "area:verify" --color 5319e7 --description "TDD, unit, mutation" || true

gh label create "priority:P0" --color d73a4a --description "Critical" || true
gh label create "priority:P1" --color e99695 --description "High priority" || true
gh label create "priority:P2" --color f9d0c4 --description "Medium priority" || true
gh label create "priority:P3" --color fef2c0 --description "Low priority" || true

gh label create "good-first-issue" --color 7057ff --description "Good for newcomers" || true
gh label create "needs-discussion" --color d876e3 --description "Needs design/architecture discussion" || true
gh label create "work-in-progress" --color fbca04 --description "Active long-term work" || true
gh label create "pinned" --color 0e8a16 --description "Persistent reference" || true
gh label create "stale" --color eeeeee --description "Inactive issue/PR" || true

gh label create "mode:unattended" --color c5def5 --description "Cloud agent contribution" || true
gh label create "mode:copilot" --color bfdadc --description "Human-supervised" || true

echo "✓ Labels created"
```

Save as `.github/scripts/create-labels.sh`, then run:

```bash
chmod +x .github/scripts/create-labels.sh
./.github/scripts/create-labels.sh
```

## Notes

- Default GitHub labels (bug, enhancement, documentation, etc.) are preserved
- Color codes follow GitHub's default palette for consistency
- All workflows use `GITHUB_TOKEN` — no additional secrets required
