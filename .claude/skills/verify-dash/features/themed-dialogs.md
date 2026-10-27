# Themed dialogs and destructive confirms

Destructive actions ask first: `Forget this bridge?` (Settings), `Delete chat?` (chat row) and `Clear ended chats?` (Chats pane). RC3 designs these as a themed, focus-trapped Dash modal with Cancel and a destructive action, one at a time, closing as Cancel on Escape or backdrop. At this checkout the themed host is not mounted and the web build still shows the browser's own `window.confirm`.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-07-08-in-app-dialogs-sheets-and-notices.spec.ts` › "Forget this bridge opens a themed, focus-trapped Dash modal with Cancel and Forget; Cancel keeps the bridge"; "Delete chat confirm is a themed dialog: Cancel keeps the row, Delete removes it"; "Clear ended confirm is a themed dialog: Cancel keeps ended rows, Clear ended removes them"; "two confirms requested back to back: one dialog at a time, the second shows after the first is answered"; "dismissal: Escape and backdrop close the dialog as Cancel; the destructive action never runs"; "Forget this bridge: dismiss cancels, accept forgets the bridge"; "two confirms back to back arrive one at a time, in request order, each answered before the next"

## Sub-features

- `dialog-forget` Forget this bridge confirm [UNCOVERED]
- `dialog-delete` Delete chat confirm [UNCOVERED]
- `dialog-clear-ended` Clear ended chats confirm [UNCOVERED]
- `dialog-queue` two confirms arrive one at a time, in order [UNCOVERED]
- `dialog-dismiss` Escape / backdrop = Cancel, nothing destructive runs [UNCOVERED] (expected FAIL at 2c948dc: `DashDialogHost` not mounted)
- `dialog-web-confirm` web `window.confirm` path with the exact message text [UNCOVERED]

## How to get to it (user POV)

- Settings, then `Forget this bridge`.
- Long-press a chat row in Chats (`Delete chat?`).
- `Clear ended` in the Chats pane.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The committed fixture is enough for Forget and Delete. Clear ended needs a second row that has ended: the draft kills the fixture OMP holder process of that bridge (`/proc` scan for `comm=omp` with the bridge's agent dir in its environment), then waits for `ended`.
- Turn In-app feedback off in Settings first (`getByRole('switch',{name:'In-app feedback',exact:true})`), otherwise the chat row long press behaves differently.

- **Forget (web confirm).** `await pair(page,bridge)`; `page.getByRole('button',{name:'Open settings'}).first().click()`. Register `page.once('dialog',...)`, then `page.getByRole('button',{name:'Forget this bridge',exact:true}).click()`. The message is `Forget this bridge?\n\nRemoves the saved address, token, and every chat on this phone.` Dismiss: the button stays. Accept: the button disappears and `localStorage['dash.settings.v1']` is null.
- **Delete chat.** `await openChat(page,bridge)`, close the window, hold the row with a real pointer for 900 ms (`chatRow(page)`). Message `Delete chat?\n\nThis removes it from this phone only.` Accept removes the row.
- **Clear ended.** `page.getByTestId('chats-pane').getByRole('button',{name:'Clear ended',exact:true}).click()`; message `Clear ended chats?\n\nSaved history is removed from this phone only.`
- **Themed dialog (once mounted).** `page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Forget this bridge?',exact:true})})` with `aria-modal`, buttons `Cancel` and `Forget`, `Escape` or `page.getByTestId('dash-dialog-backdrop')` closes as Cancel, and no browser dialog event fired.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/dialogs.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`; the recorded dialog messages and the saved-settings value are the evidence for web confirm.

## Gotchas

- Never leave a `dialog` event unanswered; Playwright dismisses it silently. Use one handler that records and answers, never two.
- `DashDialogHost`/`dash-dialog` have no importer at this checkout, and `confirmDestructive` calls `window.confirm` on web. Tests for the themed modal are expected to fail on "no system popup"; report, do not weaken.
- The queue test needs two confirms in one tick: hold the row, then click `Clear ended` through `evaluate(el=>el.click())` before releasing.
- Accepting Forget wipes the pairing; do it last in a test.
- A native `Alert.alert` is not covered by web Playwright; the web army proves only the web path.
