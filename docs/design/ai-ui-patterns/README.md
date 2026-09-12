# AI UI pattern atlas

A fail-closed catalog of design patterns used across AI products, mapped onto Dash.

This is the Dash-side consumer of two other repos:

- [kvnloo/aodl](https://github.com/kvnloo/aodl) owns harness ids, visual encodings, topologies, efforts, and runtime states. Unknown ids fail closed.
- [kvnloo/frontier-kb](https://github.com/kvnloo/frontier-kb) owns harness notes, discipline MOCs, and the inbox ingest path. Frontier owns origin writes. This tree only exports notes for `inbox/cursor/`.

Machine source of truth: [`catalog.json`](catalog.json). Dash relevance: [`dash-map.md`](dash-map.md). Frontier ingest copies: [`frontier-export/`](frontier-export/).

## Why this exists

OMP on the laptop is driving TDD through the phone. App P0s (#20, #26, #27, #28, #29) are already claimed. This atlas is the research/triage lane: what every nearby product actually ships, which of those patterns Dash already encoded in `docs/design/language.md`, and which ones would fight the thin-UI ethos (#15).

## Surfaces

| Surface | What it is | Canonical products |
|---------|------------|--------------------|
| `desktop-ide` | Editor with an agent sidecar | Cursor, Copilot, Claude Code Desktop |
| `desktop-orchestrator` | Fleet board over CLIs, not a file editor | T3 Code, Conductor, o8 |
| `desktop-chat` | Centered chat column, history rail | ChatGPT, Claude.ai, Grok.com |
| `harness-tui` | Terminal executor | omp, claude, grok, hermes, pi, fx, codex |
| `mobile-chat` | Single-column consumer chat | ChatGPT, Grok, Claude, Gemini, Perplexity |
| `mobile-remote-agent` | Phone as control surface for laptop CLIs | Dash, T3 Code mobile, Codex remote |
| `voice-overlay` | Full-screen spoken turn | Grok Voice, ChatGPT AVM, Gemini Live, Dash Voice |

AODL `o8` is a control room, not a Dash spawn target. `firstmate` is a distro. Both stay out of `hello.harnesses`.

## How to use it

1. Look up a pattern id in `catalog.json`.
2. Read `dash.status`: `shipped`, `in-flight`, `gap`, or `reject`.
3. If you change phone UI, match `docs/design/language.md` first. Do not import ChatGPT emerald, T3 three-pane desktop chrome, or Conductor worktree boards onto the S25 unless a claimed issue assigns that work.
4. Copy `frontier-export/*.md` into frontier-kb `inbox/cursor/` when promoting research. Do not origin-write frontier-kb from this repo.

## Verify

```bash
bun test docs/design/ai-ui-patterns
```

Unknown AODL ids fail the suite.
