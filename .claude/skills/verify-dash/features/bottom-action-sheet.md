# Bottom action sheet

A generic sheet that slides up from the bottom with a title, a list of option rows (destructive ones in red) and a `Close actions` control. Choosing a row closes the sheet first, then runs the action. The backdrop and Close dismiss it with no action. The intended host is the chat row long-press menu. At this checkout the sheet is not mounted, and a chat row long-press goes through the older confirm path.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-07-08-in-app-dialogs-sheets-and-notices.spec.ts` › "opens from the bottom with title, rows and Close actions; destructive rows are styled destructive"; "selecting a row closes the sheet, then runs the action"; "Close actions and the backdrop dismiss the sheet with no action"

## Sub-features

- `sheet-open` title, option rows and `Close actions` appear anchored to the bottom [UNCOVERED] (expected FAIL at 2c948dc: `BottomActionSheet` has no importer)
- `sheet-destructive` destructive row text is red [UNCOVERED]
- `sheet-select` choosing a row closes the sheet then runs the action [UNCOVERED]
- `sheet-dismiss` `Close actions` or backdrop dismisses without action [UNCOVERED]

## How to get to it (user POV)

- Long-press a chat row in the Chats list.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The committed fixture is enough: one owned `New chat` row. In-app feedback is turned off in Settings first (`getByRole('switch',{name:'In-app feedback',exact:true})`).

- **Open.** `await openChat(page,bridge)`; `page.getByRole('button',{name:'Close chat window'}).click()`; hold the row with a real pointer for 900 ms (`page.mouse.down`, `waitForTimeout(900)`, `up`) on `chatRow(page)`. `page.getByTestId('bottom-action-sheet')` is visible.
- **Content.** Heading `New chat`; `page.getByTestId('bottom-action-sheet-option-open')` has `aria-label` `Open chat: New chat, 1 of N`; `...-option-delete-local` has `Delete chat from this phone: New chat, ...` and a red-dominant text color; `getByRole('button',{name:'Close actions'})` and `bottom-action-sheet-close` are visible; the sheet bottom reaches the viewport bottom.
- **Select.** Click `bottom-action-sheet-option-open`. The sheet count is 0 and `composer(page)` is visible.
- **Dismiss.** `Close actions`, or `page.getByTestId('bottom-action-sheet-backdrop').click({position:{x:4,y:4}})`: the sheet is gone, the row remains, no chat opened.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/bottom-sheet.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png` of the open sheet; `video.webm` showing the slide in and the dismissal; `trace.zip`; `bridge.log`.

## Gotchas

- At this checkout the long press yields `Delete chat?` through `window.confirm`, so the draft's `bottom-action-sheet` assertions fail by design; do not reroute them.
- Option test ids are `bottom-action-sheet-option-<id>`; ids come from `lib/chat-row-menu.ts` (`open`, `delete-local`, ...), not from their text.
- The slide-in animates: poll the bounding box instead of reading it once.
- A press must be held by a real pointer; `click()` never triggers a long press.
