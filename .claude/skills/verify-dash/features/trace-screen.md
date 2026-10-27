# Trace screen

The Agent trace entry card opens a timeline of agent runs with Zoom fit, 1h and 3h, drag to pan, long-press to scrub a playhead, tap a row for detail, long-press a row for a menu, pinch to zoom, and action chips (Do, Not now, Undo) that record owner feedback.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-09-10-orchestra-bots-approvals-and-trace-sc.spec.ts` › "trace entry card opens the timeline; Zoom buttons set zoom; drag pans; long-press scrubs with playhead"

## Sub-features

- `trace-open` the entry card "Agent trace: N live, N cut, N need OK" opens the timeline [UNCOVERED].
- `trace-zoom-pan-scrub` Zoom fit/1h/3h, drag pan, long-press scrub with playhead [UNCOVERED].
- `trace-row-detail` tap a row opens trace detail; Close, Close detail and drag-down close it [UNCOVERED].
- `trace-row-menu` long-press a row: menu with Open details, Zoom to this run, Copy summary [UNCOVERED].
- `trace-chips-swipe` swipe right = Do, left = Not now, Undo (expires after 5 s) [UNCOVERED].
- `trace-chips-buttons` Do / Not now buttons and Undo [UNCOVERED].
- `trace-pinch` two-finger pinch zooms in [UNCOVERED].

## How to get to it (user POV)

- Orchestra tab: the Agent trace card.
- Open `dash://trace` (web route `<web>/trace`).

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Paired via `pair(page,bridge)`; the trace snapshot is the app's built-in one.

- **Open.** `page.getByRole('button',{name:/^Agent trace: \d+ live, \d+ cut, \d+ need OK$/}).click()`; `getByTestId('trace-timeline')` and `getByTestId('trace-scroll')` appear.
- **Zoom.** `getByTestId('trace-timeline').getByRole('button',{name:'Zoom 1h',exact:true}).click()` (also `Zoom fit`, `Zoom 3h`). The content layer inside `getByTestId('trace-timeline-plot')` widens.
- **Pan and scrub.** Drag with `page.mouse` on the axis row to pan. A 700 ms hold shows `getByTestId('scrub-float')` and raises `getByTestId('scrub-playhead')` opacity; release hides them.
- **Row detail and menu.** Click `timeline.locator('[data-testid^="row-"]').first()` for `getByTestId('trace-detail')`. A long-press gives `getByRole('menu')` with three `menuitem`s.
- **Chips.** `getByTestId('chip-surface-a-resume')` swipe right commits Do (`✓ Done`), `getByTestId('chip-a-resume')` Undo reverts; feedback is stored under `dash.trace.feedback/v1`.
- **Pinch.** Needs `test.use({hasTouch:true})` and CDP `Input.dispatchTouchEvent` for two touch points.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/trace.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm` (shows pan/scrub motion), `trace.zip`, `bridge.log`. Stored chip feedback must hold the chip id and `do` / `not_now` / `undo` values.

## Gotchas

- Scrub on the axis row, not a run row, or the row menu opens instead.
- Chips animate; allow ~500 ms after Zoom clicks and expect Undo to disappear after 5 s.
- Pinch and swipe use trusted input; pure `dispatchEvent` does not work.
- Draft locators all exist in app source (checked by grep).
