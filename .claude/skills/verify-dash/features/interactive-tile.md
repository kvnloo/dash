# Interactive tile

Tiles (stat tiles, timeline and orchestra items) respond to gestures. Tap opens a detail sheet, double-tap pins the tile locally, triple-tap copies its summary, and hold-slide-release picks a radial action. On web, Enter, P and C do the same as tap, double-tap and triple-tap. The Component lab's `Gesture playground` tile is the clean place to see it.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-07-08-in-app-dialogs-sheets-and-notices.spec.ts` › "tap opens the tile detail sheet; Close tile detail closes it"; "Dismiss tile detail (backdrop) closes the sheet"; "double-tap pins (label + note reflect pinned), double-tap again unpins, no detail opens"; "triple-tap copies the summary (label + note reflect copy state, clipboard holds summary)"; "web keyboard equivalents: Enter opens detail, P pins, C copies"

## Sub-features

- `tile-open` tap opens `tile-detail` [UNCOVERED]
- `tile-close` `Close tile detail` and `Dismiss tile detail` (backdrop) close it [UNCOVERED]
- `tile-pin` double-tap pins, again unpins, no detail opens [UNCOVERED]
- `tile-copy` triple-tap copies the summary [UNCOVERED]
- `tile-keys` web keys Enter / P / C [UNCOVERED]
- `tile-radial` hold, slide and release picks a radial action [UNCOVERED] (touch only)

## How to get to it (user POV)

- Settings, then `Component lab`, scroll to `Gesture playground`.
- Tap any stat tile in Trace or Orchestra.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The committed fixture is enough; the lab screen is static app UI and needs no agent turn.
- The context grants `clipboard-read` and `clipboard-write` for the copy journey.

- **Open the lab.** `await pair(page,bridge)`; `page.getByRole('button',{name:'Open settings'}).first().click()`; `page.getByRole('button',{name:'Component lab',exact:true}).click()`; `const tile=page.getByTestId('gesture-playground')`, `scrollIntoViewIfNeeded()`. Its `aria-label` starts `Gesture playground. Tap opens detail.`
- **Tap.** `await tile.click()`. `page.getByTestId('tile-detail')` is visible with the summary and `Informational detail. No upstream action has been sent.`
- **Close.** `page.getByRole('button',{name:'Close tile detail'}).click()` or `page.getByRole('button',{name:'Dismiss tile detail'}).click({position:{x:4,y:4}})`; `tile-detail` count is 0.
- **Pin.** `await tile.dblclick()`. `aria-label` ends `. Pinned locally.` and the text `Pinned · this view` shows; a second double-click unpins.
- **Copy.** `await tile.click({clickCount:3})`. `aria-label` ends `. Summary copied.`; `navigator.clipboard.readText()` equals the summary.
- **Keys.** `await tile.focus()`; `keyboard.press('p')` pins, `'c'` copies, `'Enter'` opens detail.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/interactive-tile.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png` showing the tile state or detail; `video.webm` showing the gesture; `trace.zip`; `bridge.log`.

## Gotchas

- The tile's tap waits to see whether it is a double or triple tap, so the detail opens slightly late; use an expectation with a timeout, not an immediate check.
- `click({clickCount:3})` is one triple-tap; three separate clicks may open the detail instead.
- Copy state comes from the clipboard promise; without clipboard permission the label ends in a failed state.
- The radial hold-slide-release path is touch-driven and not reachable with a mouse in RN Web; it needs a native lane.
- Detail sheets cover the page (`zIndex 9999`); close it before the next gesture.
