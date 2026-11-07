# Chats list

The Chats pane lists every conversation, grouped under date headers (Today, Yesterday, ...). Each row shows a title, time, a harness/host badge, the working folder, activity and a preview; rows from other hosts say "View only". A gold live dot marks a session still running on the host, the open chat's row has a faint gold tint, an empty list says "No chats yet", loading shows skeleton rows, and a failed page shows "<error> · Retry".

Status: COVERED by `e2e/mbp-army/army.spec.ts` › "pairing, Chats tab, open and close real chat window"; "draft text survives close, reopen and real browser reload"
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-01-02-chats-list-and-chat-list-long-press-m.spec.ts` › "Chats with zero conversations shows No chats yet"; "remote index loading shows 6 skeleton rows, then rows replace them"; "rows are grouped under date headers with row counts"; "row shows title, time, harness/host badge, working folder, activity and preview; foreign row is View only"; "tap a remote-only row: it becomes a phone conversation and Chat opens with its history"; "scroll to bottom loads the next page with 3 footer skeleton rows"; "remote index error shows \"<error> · Retry\" in the footer and Retry reloads"; "host-running session row shows the gold live dot and Live on host label"; "tap a local chat row: row gets the active tint and the Chat window opens"

## Sub-features

- `list-open-row` tapping a local row reopens its chat window. [covered: "pairing, Chats tab, open and close real chat window"]
- `list-row-after-close` the row survives close and reopens with its draft. [covered: "draft text survives close, reopen and real browser reload"]
- `list-empty` "No chats yet". [UNCOVERED]
- `list-skeleton` six skeleton rows while loading, three while paging. [UNCOVERED]
- `list-date-groups` Today/Yesterday headers with counts. [UNCOVERED]
- `list-row-content` title, time, badge, folder, preview, "View only". [UNCOVERED]
- `list-remote-row` a remote-only row ("Not opened yet") opens with history. [UNCOVERED]
- `list-paging-retry` scroll loads the next page; error footer Retry. [UNCOVERED]
- `list-live-dot-tint` "Live on host" dot and active tint. [UNCOVERED]

## How to get to it (user POV)

- Select the Chats dot in the top nav. Close a chat window or press Back from a full-screen chat to return to it.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- `pair(page, bridge)` (lands on Chats). The fixture roster has a native OMP row and a Hermes row titled `ARMY native fixture`. Other rows need extra seeding.

- **See the pane.** `await expect(page.getByTestId('chats-pane')).toBeVisible()`. Rows are `chats-pane` descendants matching `[data-testid^=chat-row-]`.
- **Find your row.** After `openChat()`, `chatRow(page)` is the exact `New chat` row. Never use the first row.
- **Open a row.** `await chatRow(page).click({noWaitAfter:true})`. `getByTestId('chat-window')` appears and `composer(page)` is in the viewport.
- **Live dot.** `page.getByTestId('chats-pane').getByLabel('Live on host',{exact:true})` should show for the fixture session (uncovered).
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "pairing, Chats tab, open and close real chat window"`
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. `final.png` must show the Chats pane with the row beneath the reopened window; the video must show the row opening the window.

## Gotchas

- Date groups, skeletons, paging and error Retry need bridge-side index data and network latency control that the committed fixture does not provide. Report them UNCOVERED, not passing.
- Skeleton rows have no accessibility attributes on web; the draft counts them by size.
- Rows from other hosts are `View only`; a local row never is.
- The cold app opens on Orchestra, so select Chats first.
