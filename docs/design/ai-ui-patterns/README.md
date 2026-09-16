# AI UI pattern atlas

A fail-closed catalog of design patterns used across AI products, mapped onto Dash.

This is the Dash-side consumer of two other repos:

- [kvnloo/aodl](https://github.com/kvnloo/aodl) owns harness ids, visual encodings, topologies, efforts, and runtime states. Unknown ids fail closed.
- [kvnloo/frontier-kb](https://github.com/kvnloo/frontier-kb) owns harness notes, discipline MOCs, and the inbox ingest path. Frontier owns origin writes. This tree only exports notes for `inbox/cursor/`.

## Start here

1. [`synergy.md`](synergy.md) — case study. Attention, synergy loop, compression, gestures, micro-interactions.
2. [`decisions.json`](decisions.json) — inspectable tree. Walk `walk` in order. Do not skip.
3. [`tree.ts`](tree.ts) — derives `lock` / `fork` / `claimed` / `gap`. Adding a node without classifying it fails the suite.
4. [`inventory.md`](inventory.md) — every screen, control, gesture, dead affordance.
5. [`attention.md`](attention.md) — axioms.
6. [`catalog.json`](catalog.json) — competitor + AODL pattern database.
7. [`dash-map.md`](dash-map.md) — what to take, reject, or leave to claimed PRs.

## How to use the tree (deterministic)

```
for id in walk:
  read the node
  kind = lock | fork | claimed | gap   # derived, not a vibe
  if lock:  chrome is frozen until you edit the node, then the code
  if fork:  two written sources disagree. Do not silently pick.
  if claimed: GitHub issue already owned. Do not implement from this catalog.
  if gap:  proposedIssues[] is the ticket. Do not invent a fourth option.
```

`adopted` is what ships on `main`. `target` is what the tree says is right. They match, or the gap is named.

Phone pixels still follow `docs/design/language.md` first. Two forks are named there (default tab Chats vs issue #29, pencil vs dock).

## Verify

```bash
bun test docs/design/ai-ui-patterns
```

Unknown AODL ids fail. A decision node whose wiring file is missing fails. A silent new chrome (bottom tabs, dead +, list entering, Expand→Voice, debug-only picker) fails the source contracts. The lock/fork/claimed/gap partition is an exact set.

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
