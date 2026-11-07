---
id: inbox-20260911-ai-ui-pattern-atlas
title: AI UI pattern atlas for Dash (AODL + competitors)
type: inbox
status: draft
created: 2026-09-11
updated: 2026-09-11
node: cursor
harnesses: [omp, hermes, grok, claude, codex, pi, fx, o8, cursor]
domains: [tool-use, frameworks, ai-ml]
tags: [inbox, ui, dash]
---

# AI UI pattern atlas for Dash

## Context

Dash (`kvnloo/dash`) needs a fail-closed map of AI UI patterns across desktop IDEs, desktop orchestrators, harness TUIs, and mobile chat / remote-agent apps. Canonical harness ids stay in [aodl harnesses/catalog.json](https://github.com/kvnloo/aodl/blob/main/harnesses/catalog.json). Visual efforts, topologies, operating modes, and runtime states stay in [aodl encodings/visual.json](https://github.com/kvnloo/aodl/blob/main/encodings/visual.json).

Dash-side database: `docs/design/ai-ui-patterns/catalog.json` in kvnloo/dash. This note is the frontier-kb ingest copy. Promote to literature/permanent; do not origin-write harness notes from a Dash worker.

## Next action

CoS: copy this file to `inbox/cursor/` in frontier-kb. Frontier: link patterns to `harnesses/*` and `domains/tool-use`. Do not treat T3 Code or Conductor as AODL executors.

## Links

- Dash atlas: https://github.com/kvnloo/dash/blob/main/docs/design/ai-ui-patterns/README.md
- AODL catalog
- AODL visual.json
- T3 Code: https://t3.codes/ (desktop + iOS/Android control plane over Claude/Codex/OpenCode/Cursor/Grok)
- Conductor: https://www.conductor.build/ (Mac parallel Claude/Codex/Cursor in worktrees)
- ChatGPT design notes: chrome under ~15% viewport, docked composer, rAF token commit
- Dash language: Grok History + Grok Voice + Zero black, not ChatGPT emerald
