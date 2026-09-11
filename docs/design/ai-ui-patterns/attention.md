# Attention and human-AI synergy

Dash is a phone. The human has one fovea, about four working-memory slots, and a thumb. The laptop agent has unbounded tool output. The UI's job is to **encode intent, show only the slot that is working, then get out of the way**.

Frontier-kb already named the human half: encode, retrieve, rest, measure, prune (`domains/learning-acceleration`, `perm-20260911-encoding-beats-exposure`, `perm-20260911-plasticity-needs-alert-then-rest`). This file is that protocol applied to a 390×844 control surface.

The inspectable tree is [`decisions.json`](decisions.json). The case study is [`synergy.md`](synergy.md). Kind is derived in [`tree.ts`](tree.ts): `lock` (adopted === target), `fork` (lock with two written sources), `claimed` (issue already owned), `gap` (named in `proposedIssues`). A later agent cannot "prefer" bottom tabs without changing the node. That is the determinism.

## Axioms (do not skip)

1. **One foveal stream.** Streaming tokens occupy attention. Status, tools, and chrome must live in parafovea (one line) or periphery (4px dots). A tool accordion, blinking caret, or gold glow overlay fights the stream.
2. **Four chunks.** Miller-ish working memory. Three destinations (Bots, Chats, Orchestra) plus one composer. Scope chips stay hidden until focused. A persistent model picker is a fifth chunk we refuse.
3. **Encode, do not expose.** A Chats row is a 1-line preview, not the transcript. Opening the row is retrieval. List dump is familiarity, not encoding (`encoding-beats-exposure`).
4. **Alert, then rest.** Press squash + haptic is the alert tag. Lists do not `entering=`. Streaming does not bounce the row. The 8px PulseDot is the only idle motion in a thread.
5. **Measure, do not vibe.** Geometry and wiring are pinned (`golden-nav.ts`, `KeyboardDock.test.ts`, `motion.test.ts`). A screenshot without a pin is not a decision.
6. **Prune unused chrome.** Connection pill mounts only when offline. Chips only when focused. Bridge details are a pull sheet, not a second tab.

## Synergy loop (phone)

| Stage | Human | Dash surface | Forbidden |
|-------|-------|--------------|-----------|
| Encode | Type, speak, `@`, `/` | Composer, search dock, Voice | FAB over the last token |
| Work | Watch one status line | `status` event, PulseDot / effort orbs | Tool cards, thinking caret |
| Retrieve | Open a row | Chat hydrate, `/live` | Empty thread for a live session |
| Rest | Scroll, swipe panes | FlashList, gel pager | Per-row enter animations |
| Measure | See failure, reconnect | Inline error, ConnectionPill | Silent hang |
| Prune | Long-press delete, forget bridge | Chats long-press, Settings | Hidden swipe-to-delete with no hint |

## Attention budget on the S25

The S25 Ultra is tall and edge-to-edge. Thumb reach is the **bottom third**. That is why the composer and `@` dock own the bottom, and destinations are **top dots**. Bottom tabs would steal the dock. ChatGPT's bottom bar is a consumer-chat pattern. Dash already spent that pixel budget on the IME-sticky composer.

Nav chrome is **60px**. Header is **52px**. Composer minHeight **48px**. Those numbers are the attention tax. Adding a second bar is a tax increase. The tree rejects it.

## Compression catalog (what we actually do)

| Signal | Bits | Where |
|--------|------|-------|
| Destination | 3 dots, not labels in the pill | AppNav |
| Presence | 6px `--ok` / `--faint` | Bots, Orchestra |
| Live work | 1-line status + 8px pulse | MessageRow |
| History | date group + 1 preview + timeAgo | ChatsPane |
| Search scope | chips only on focus | GlobalSearchBar |
| Bridge health | pill or nothing | ConnectionPill |
| Send vs voice | mic when empty, send when text | Composer |
| Stop | square that replaces send's neighbor | Composer streaming |

## What we inspected and still refuse

Desktop three-pane, worktree boards, split diffs, ChatGPT emerald, hosted model identity. See `dash-map.md`. Those are not "maybe later on mobile." They fail axioms 1-3.

## Gaps the tree does not forgive

`bun test docs/design/ai-ui-patterns` pins the gap set. It is not taste. Full list and ticket bodies: `decisions.json` `proposedIssues`. Inspection notes: [`inventory.md`](inventory.md).

Headline lies and silent affordances:

- Composer `+` has no `onPress`. Same glyph is live Mention on Main.
- Left nav says Expand and opens Voice.
- Chat / Voice hardcode `tab={1}` so Orchestra origin looks like Chats.
- HarnessPicker is debug-only. Conversations is a stack zombie. Header/TopTabs are unused.
- Long-press delete has no hint. Orchestra agent rows haptic then no-op.
- PulseDot and Voice orb ignore Reduce Motion. Pair/Settings still use opacity press.
- Search writes Online/Offline. Bots uses a dot.
- No fleet marks. No blocked chrome. No Voice End control.

Forks (two written sources, tree keeps shipped):

- Default tab Chats vs issue #29 Orchestra.
- language.md pencil vs bottom Message Dash dock.

Claimed (do not steal): #19 Orchestra AODL, #20 live sessions, #27 effort orbs.

This environment cannot open GitHub issues (`gh` is read-only). The nodes are the source of truth until someone files them.
