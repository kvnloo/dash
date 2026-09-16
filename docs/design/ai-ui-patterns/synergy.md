# Human-AI synergy on a phone

This is the case study. [`decisions.json`](decisions.json) is the spec. [`tree.ts`](tree.ts) classifies every node. [`inventory.md`](inventory.md) is the inspection of `app/src`. An agent that "prefers" a different chrome without editing a node is off-protocol.

Walk `decisions.json` `walk` in order. Do not skip. Do not invent a fourth option.

## What the human is doing

A Dash user is not chatting with a hosted model. They are directing laptop CLIs (OMP, Codex, Grok, Claude, Hermes, pi, fx) from one thumb, often while the laptop is in another room. That is the same job as T3 Code's phone app. ChatGPT's job is different. It resells tokens and makes the model name a fifth working-memory chunk.

The synergy loop is four moves, always in this order:

1. **Encode** intent (type, speak, `@`, `/`).
2. **Work** while the harness uses tools. The human watches one status line, not the JSON.
3. **Retrieve** a row, a live session, a host, a failure.
4. **Rest** (scroll, swipe, look away). Then measure (inline error, reconnect) and prune (delete a thread, forget a bridge).

The failure mode of AI UIs is babysitting. The human stares at tokens they will not remember, then cannot encode the next instruction. Frontier-kb already named the human half (`encoding-beats-exposure`, `plasticity-needs-alert-then-rest`, `measure-the-learning-loop`). This phone has to obey that protocol in 390×844.

## Attention (the budget)

| Fact | Design consequence |
|------|-------------------|
| One fovea (~2°). Streaming text owns it. | Status, tools, chrome live in parafovea (one line) or periphery (4px dots). No tool accordion. No blinking caret. No gold glow overlay. |
| Working memory is ~4 chunks (Cowan), not 7±2. | Three destinations + one composer. Scope chips hide until focus. No persistent model picker. |
| Peripheral vision is good at motion, color, position. Bad at words. | Destinations are dots, not a labeled bottom bar. Presence is an 8px dot, never an "Online" pill. |
| Encode ≠ expose. Familiarity is not memory. | Chats rows are 1-line previews. Opening is retrieval. Dumping the transcript into the list is a fail. |
| Alert, then rest. Motion tags an event. Idle motion is a tax. | Press squash + haptic on the action. No `entering=` on FlashList recycle. PulseDot is the only idle motion in a thread, and it must honor Reduce Motion. |
| Dual-task interference. Watching a stream while composing the next thought is two jobs. | Stop stays reachable. Queue is a second slot in the same thread, not a new chat. |
| Thumb reach on an S25 is the bottom third. The window does not resize for the IME. | Composer and `@` dock own the bottom and `translateY` with the keyboard. Destinations are top dots. Bottom tabs would steal the dock. |
| Change blindness. If a control looks tappable and does nothing, the next real control is distrusted. | Dead `+`, silent agent rows, debug-only pickers, mislabeled Expand are not polish. They are attention bugs. |

Measure, do not vibe. Geometry is pinned (`NAV_CHROME_HEIGHT = 60`, `NAV_DOT_SIZE = 4`, KeyboardDock `translateY: height.value`). A screenshot without a pin is not a decision.

## Compression grammar (already shipped)

Bits, not decoration.

| Signal | Encoding | Forbidden |
|--------|---------|-----------|
| Destination | 3×4px dots + gel pill | Bottom tab labels |
| Presence | 8px `--ok` / `--faint` | Online / Away chips |
| This-turn work | 1-line `status` + 8px PulseDot | Tool cards, row bounce |
| Other live turns | 8px dot on a Chats row | Split view of two threads |
| History | Date group + 1 preview + timeAgo | Multi-line snippet |
| Search scope | Chips only on focus | Persistent chip row |
| Bridge health | ConnectionPill only when broken | Always-on Connected |
| Send vs voice | Mic when empty, send `popIn` | Both icons at rest |
| Stop | Square beside queue | Disabled composer |
| Failure | Inline in the turn | Toast that dies |

## Gesture grammar (one axis per gesture)

| Axis | Owner | Must not |
|------|-------|----------|
| Horizontal | MainPager destinations | Nested horizontal lists |
| Vertical | FlashList content | Bridge pull from the list |
| Top-edge pan down | BridgePull on nav chrome | Modal |
| Press | PressScale SNAP squash | Opacity `pressed` styles |
| Long-press 350ms | Chats delete | Fire on scroll |
| IME | KeyboardDock translateY | `paddingBottom: insets.bottom` as the lift |
| Speech barge-in | VoiceSession stops TTS | Wait for the model to finish talking |

The leftover fight is BridgePull vs list scroll if the human pulls from the top of a pane. The tree names it (`gesture.bridge-vs-list`). Do not "fix" it with a nested horizontal scroller.

## Micro-interactions (one language)

| Event | Motion | Haptic |
|-------|--------|--------|
| Row / chip / send / nav circle | PressScale 0.985 / 0.92 / 0.9 | Call-site `tap` / `select` |
| Send appears | `popIn` / `popOut` | Parent `tap` today (gap: first send should be `success`) |
| Scope chips | `staggerUp` 36ms + LinearTransition | `tap` |
| Connection drop | `enterDown` | none (the pill is the alert) |
| Nav pill | GEL follow, stretch X squash Y | none (peripheral) |
| Page body | PAGE_LAG_PX gel | none |
| Thinking | PulseDot opacity loop | none |
| Pair success / fail | none | `success` / `error` |

Springs already pass `ReduceMotion.System`. PulseDot and the Voice orb loop `withTiming` forever. That is a vestibular tax and a named gap.

Header, Pair, Settings, OrchestraDetail, and Conversations still use opacity press. AppNav tabs are a raw `Pressable`. That is three dialects. The tree's target is one.

## How the tree converges (determinism)

```
for id in walk:
  node = nodes[id]
  kind = lock | fork | claimed | gap
  # lock:  adopted == target. Chrome is frozen until the node changes.
  # fork:  lock, but two written sources disagree. Do not silently pick.
  # claimed: adopted != target, GitHub issue already owned. Do not steal.
  # gap:  adopted != target, no owner. proposedIssues[] is the ticket body.
```

`bun test docs/design/ai-ui-patterns` pins:

- Walk covers every node exactly once.
- Wiring files exist.
- Source contracts for shipped chrome (60px, translateY, no `entering=`, send/mic swap).
- Source contracts for named lies (dead Attach, Expand→Voice, debug-only picker, unused Conversations).
- The partition of lock / fork / claimed / gap is an exact set. Adding a node without classifying it fails.

Changing shipped chrome requires editing the node first, then the code. That is the whole point.

## What we inspected and still refuse

Desktop three-pane, worktree boards, split diffs, ChatGPT emerald, hosted model identity, Gemini Live camera, floating composers, bottom tab bars, `entering=` on lists, GOLD_GLOW on native AppNav. Those fail the axioms. They are not a later phone milestone.

## Claimed vs unclaimed

In-flight app P0s (#19 Orchestra AODL, #20/#26/#28 live sessions, #27 effort orbs, #29 Orchestra default) already have owners. The tree records `claimedIssue` and stops. This catalog must not implement them.

Unclaimed gaps are lying or silent affordances, mixed press, idle Reduce Motion, fleet marks, blocked chrome, Voice without an end control. Ticket bodies live in `proposedIssues`. This environment cannot open GitHub issues (`gh` is read-only).
