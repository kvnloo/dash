# Long reply and selection

A very long assistant reply is shown truncated with a `Show full message` button; tapping it renders the whole text. On the web, long-pressing reply text leaves the browser's own text selection alone. On Android a long press opens a selection sheet that can quote part of the reply back into the composer.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-06-07-transcript-rendering-links-tool-rows-.spec.ts` › "07.10 a truncated long reply shows Show full message; tapping it renders the full text"; "07.11 long-press reply text (350 ms) on web keeps OS selection; the Android selection sheet does not open"

## Sub-features

- `long-truncate` long reply is cut with `Show full message`; tap shows the tail [UNCOVERED]
- `selection-web` long press keeps OS selection, no sheet opens on web [UNCOVERED]
- `selection-quote` Android selection sheet quotes the selection into the composer [UNCOVERED] (native only, no army lane)

## How to get to it (user POV)

- Open a chat that has a very long reply and tap `Show full message`.
- Press and hold on reply text, then drag the handles to select.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The committed fixture agent only echoes up to 220 characters of the prompt, so it cannot produce a long reply. The draft seeds a Hermes chat with one 900-repeat assistant message via uncommitted `rc3-chat-index-seed.ts` (bridge stopped, seed, `bridge.start()`), and selection uses the `ARMY_R07_MD` scenario from an uncommitted fixture-agent extension.

- **Open the seeded chat.** `await pair(page,bridge)`; `page.getByTestId('chats-pane').locator('[data-testid^="chat-row-"]').filter({has:page.getByText('ARMY R07 long',{exact:true})}).click()`.
- **Truncated.** `ARMY_LONG_HEAD` is attached, `ARMY_FULL_TAIL` count is 0, `page.getByRole('button',{name:'Show full message',exact:true})` is visible.
- **Expand.** Click `Show full message`. `ARMY_FULL_TAIL` becomes attached and the button count is 0.
- **Long press on web.** Hold a real pointer for 900 ms on a paragraph: `page.mouse.move`, `mouse.down`, `waitForTimeout(900)`, `mouse.up`. `getByTestId('reply-selection-input')` and `getByTestId('reply-to-selection')` have count 0; `userSelect` is not `none`; `locator.selectText()` makes `window.getSelection()` contain the text; the composer stays empty.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/long-reply.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png` shows the expanded long reply; `video.webm`; `trace.zip`; `bridge.log`.

## Gotchas

- The long text is attached before it is visible (virtualized list): assert `toBeAttached`, not `toBeVisible`, for head and tail.
- `Markdown.onLongPress` returns early unless the platform is Android, so `reply-selection-input` and `reply-to-selection` exist only on native. Web can only prove the absence of the sheet; the quote journey needs a native army lane that does not exist yet.
- Seeding a chat requires stopping the bridge first, otherwise the index misses the row.
- Playwright `selectText()` is not a user long press; keep both checks.
