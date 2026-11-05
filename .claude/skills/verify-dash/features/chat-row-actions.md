# Chat row actions (long-press)

Holding a row in the Chats list must never send anything. At this build, a long-press either selects the chat for in-app feedback (Settings "In-app feedback" On) or asks "Delete chat?" (Off) and removes the row from this phone only. RC3 #415 adds a bottom action sheet (Open, Open as window, Copy session id, Send feedback, Delete from this phone), but that sheet is not mounted yet. A "Clear ended" button removes ended chats after a confirm.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-send-longpress.spec.ts` › "long-press on a chat row opens the row menu and sends NOTHING"; `e2e/mbp-army/rc3-01-02-chats-list-and-chat-list-long-press-m.spec.ts` › "long-press with In-app feedback Off confirms Delete chat?; Cancel keeps, Delete removes from phone only and the index row comes back"; "ended chats: Clear ended confirm; Cancel keeps rows, Clear ended removes them"; "long-press with In-app feedback On submits \"Selected chat <title>\" and navigates to Chat"; "sheet shows chat title and Open, Open as window, Copy session id, Send feedback, Delete from this phone"

## Sub-features

- `row-longpress-sends-nothing` a long-press sends no turn to the bridge. [UNCOVERED]
- `row-delete-confirm` feedback Off: `Delete chat?` confirm, Cancel keeps, Delete removes. [UNCOVERED]
- `row-feedback-on` feedback On: long-press selects the chat for feedback and opens Chat. [UNCOVERED]
- `row-clear-ended` Clear ended confirm. [UNCOVERED]
- `row-action-sheet` bottom action sheet with five options (#415). [UNCOVERED] Not mounted at this checkout.

## How to get to it (user POV)

- Press and hold a row in the Chats list (about half a second).
- For feedback mode, turn on Settings > In-app feedback first.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- `pair(page, bridge)`. A row to hold: the fixture's `ARMY native fixture`, or your own via `openChat()` then `Close chat window`.

- **Long-press.** Use a real pointer hold, not `click`: `await row.hover(); await page.mouse.down(); await page.waitForTimeout(900); await page.mouse.up();`.
- **Delete path (feedback Off).** `page.once('dialog', d => d.accept())` captures `Delete chat?\n\nThis removes it from this phone only.`; the row's `data-testid` then has count 0.
- **Nothing sent.** Count `ws.chat `, `turn.start` and `turn.rejected` lines in `bridge.logs()` before and after; the count must not change.
- **Sheet (draft expectation).** `getByTestId('bottom-action-sheet')` shows options with names like `Open chat: <title>` and closes with `getByTestId('bottom-action-sheet-close')`.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/chat-row-actions.spec.ts`), then `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. `bridge.log` must contain no new turn lines after the hold; `final.png` shows the list with the expected row state.

## Gotchas

- Expected FAIL at 2c948dc for `rc3-send-longpress.spec.ts`: `bottom-action-sheet`, `bottom-action-sheet-close` and the option names are defined in `BottomActionSheet.tsx` and `chat-row-menu.ts`, but nothing mounts them. The row wiring uses `chat-row-actions.ts`.
- The long-press delay is 350 ms; hold at least 900 ms for the web pointer.
- Web `confirm` is a native dialog, so handle it with `page.once('dialog')` before holding.
- The draft file `rc3-send-longpress.spec.ts` also needs an `archiveClaude` fixture option that the committed `fixtures.ts` does not have; only its first and last tests are runnable here.
- A deleted remote-backed row comes back as "Not opened yet" after the index refreshes: delete is phone-local only.
