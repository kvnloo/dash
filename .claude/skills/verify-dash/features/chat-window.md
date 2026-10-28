# Chat window

Tapping a Chats row opens the chat as a window over Main. A pill at the top shows the chat title with a status slot (working, offline, a running tool, queued) and toggles the app nav; a dock at the bottom holds the identity badge and a close button. Closing the window morphs back into the row.

Status: COVERED by `e2e/mbp-army/army.spec.ts` › "pairing, Chats tab, open and close real chat window"
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-02-03-chat-screen-chrome-header-full-screen.spec.ts` › "03.11 return to Main and tap the exact row: windowed chat with pill and dock"; "03.12 window pill status slot reflects idle/thinking/tool/queued/offline and toggles app nav"; "03.14 Close chat window returns to Main with a morph animation"

## Sub-features

- `win-open-from-row` tap the row, `chat-window` appears with a usable composer. [covered: "pairing, Chats tab, open and close real chat window"]
- `win-close-reopen` `Close chat window` removes the window, the row stays, reopening works. [covered: "pairing, Chats tab, open and close real chat window"]
- `win-pill-title` `chat-window-pill` and `chat-window-pill-title` read the chat title. [UNCOVERED]
- `win-pill-status` the status slot shows `working`, a tool name or `offline`. [UNCOVERED]
- `win-pill-nav-toggle` the pill shows or hides the window's own nav. [UNCOVERED]
- `win-close-morph` close animates through intermediate opacity. [UNCOVERED]

## How to get to it (user POV)

- Chats pane > tap a row.
- Close with the X in the dock.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- `openChat(page, bridge)` does the pairing, creates `New chat`, goes Back, records the exact row and opens it.

- **Open.** `await chatRow(page).click({noWaitAfter:true})`; `await expect(page.getByTestId('chat-window')).toBeVisible()`.
- **Badge.** `await expect(page.getByTestId('chat-window-badge')).toContainText('mbp')`.
- **Close.** `await page.getByRole('button',{name:'Close chat window',exact:true}).click({noWaitAfter:true})`. `chat-window` has count 0 and `getByRole('tab').nth(1)` is still `aria-selected="true"`.
- **Reopen.** `await chatRow(page).click({noWaitAfter:true})`; `composer(page)` is in the viewport.
- **Pill status (not driven).** `ARMY_HANG` then `getByTestId('chat-window-pill-status')` reads `working`; `Stop` clears it.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "pairing, Chats tab, open and close real chat window"`
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. The video must show open, close and reopen; `final.png` shows the reopened window with the composer.

## Gotchas

- Use `{noWaitAfter:true}` on clicks; the morph animation keeps navigation "pending".
- The windowed header has no `Options` toggle or `Back` button; those are full-screen only.
- Hold the exact row from `chatRow(page)`, never the first row, so other roster rows do not interfere.
- The window pill is a separate control from the top nav tabs. With the nav toggled on, `Chats` tab counts double; compare counts, do not assume one.
- The mouse close animation is short; sample opacity per frame if you need to prove it.
