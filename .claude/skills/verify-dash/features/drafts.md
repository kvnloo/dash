# Drafts survive

Text typed in the composer but not sent is kept per chat. The user can close the chat window, switch tabs, or reload the app, reopen the same chat and find their text still in the `Message` box.

Status: COVERED by `e2e/mbp-army/army.spec.ts` › "draft text survives close, reopen and real browser reload"
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-03-04-composer-controls-chips-and-send-gate.spec.ts` › "04 draft persists across navigating to another tab and back to the same chat"

## Sub-features

- `draft-close-reopen` close the window, reopen the row, text restored [covered: "draft text survives close, reopen and real browser reload"]
- `draft-reload` real browser reload, reopen, text restored (stored in `dash.composerDrafts.v1`) [covered: "draft text survives close, reopen and real browser reload"]
- `draft-tab-switch` switch to another tab and back [UNCOVERED]
- `draft-oversized` a very large draft does not crash the restart (see delivery-status-outbox) [UNCOVERED]

## How to get to it (user POV)

- Type in a chat's `Message` box, leave the chat (Close chat window, Back, or another tab), then reopen the chat from the Chats tab.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.

- **Type.** `await openChat(page,bridge); await composer(page).fill('unsent draft persists through real reload')`.
- **Close and reopen.** `await page.getByRole('button',{name:'Close chat window',exact:true}).click({noWaitAfter:true}); await chatRow(page).click({noWaitAfter:true})`. `await expect(composer(page)).toHaveValue(draft)`.
- **Storage.** `page.evaluate(()=>localStorage.getItem('dash.composerDrafts.v1'))` contains the draft.
- **Reload.** `await page.reload({waitUntil:'domcontentloaded'})`, wait for `getByRole('tab').nth(1)`, click it, `await chatRow(page).click(...)`. The box has the same value again.
- **Tab hop (uncovered).** After Close, click `getByRole('tab').nth(0)` and back to `nth(1)`, reopen `chatRow(page)`.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "draft text survives close, reopen and real browser reload"`
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`. They must show the draft text in the box after reload, and nothing sent (no turn in `bridge.log`).

## Gotchas

- Reload resets the app to Orchestra; the test must select the Chats tab and use `chatRow(page)` (the exact owned row), never the first row.
- The new chat window and its row id come from `openChat`; reload keeps the row only because the chat is saved on the device.
- Web `localStorage` is not native storage; native persistence is not proven by this test.
