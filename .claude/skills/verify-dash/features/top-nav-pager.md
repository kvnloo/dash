# Top nav and pager

The top of Main shows three dots (Bots, Orchestra, Chats) with a gold pill under the selected one, an Expand circle that opens Voice, and an S Pen mode pill that flips between Normal and Annotate. The pane below follows the dots, and swiping the pane moves the gold pill with the finger. A cold app opens on Orchestra (tab 2).

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-00-01-navigation-shell-top-nav-and-bridge-p.spec.ts` › "cold start opens Main on Orchestra (tab 2) with Orchestra selected"; "tap Chats moves the gold pill to the middle dot and renders chats-pane"; "swipe pager Chats to Orchestra: pill tracks the finger 1:1 and settles without a second animation"; "Expand circle opens the Voice screen"; "S Pen mode pill toggles Normal and Annotate and the annotation overlay"

## Sub-features

- `nav-cold-orchestra` cold start selects Orchestra and shows `orchestra-graph`. [UNCOVERED]
- `nav-tap-tabs` tapping Bots, Chats or Orchestra selects the tab and moves the gold pill. [UNCOVERED] (`pair()` clicks the Chats tab but asserts only `aria-selected` and `chats-pane`.)
- `nav-swipe-pager` dragging the pane moves the pill 1:1 and settles on the target dot. [UNCOVERED]
- `nav-expand-voice` the Expand circle opens the Voice screen. [UNCOVERED]
- `nav-spen-mode` the S Pen pill toggles Normal and Annotate and shows the annotation tray. [UNCOVERED]

## How to get to it (user POV)

- Open the app after pairing. The dots sit at the top of Main.
- Tap a dot, or swipe the pane left or right.
- Tap the round Expand button for Voice, or the S Pen pill for annotation mode.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- A paired page that has NOT chosen a tab. `pair()` selects Chats, so pair by hand: fill the `100.64.0.1` placeholder, `Bootstrap token`, click `Pair over Tailscale`, then wait for `getByRole('tab',{name:'Orchestra',exact:true})`.

- **Cold start.** `await expect(page.getByRole('tab',{name:'Orchestra',exact:true})).toHaveAttribute('aria-selected','true')` and `await expect(page.getByTestId('orchestra-graph')).toBeVisible()`.
- **Tap a dot.** `await page.getByRole('tab',{name:'Chats',exact:true}).click()`. The tab is selected, `getByTestId('chats-pane')` shows, and the heading `Chats workspace` (`getByRole('heading',{name:'Chats workspace',exact:true})`) appears. Bots gives `Bots workspace`.
- **Swipe.** Drag with `page.mouse` across `getByTestId('main-pager')` (mouse down, `move` in steps, up). `getByTestId('main-pager-track')` carries a CSS transform that follows the drag, and the pill (first child of `getByLabel('Primary mobile workspace',{exact:true})`) tracks it.
- **Expand.** `await page.getByRole('button',{name:'Expand',exact:true}).click()`. A heading `Voice` or `Live call` and `getByTestId('voice-caption')` appear.
- **S Pen pill.** `await page.getByTestId('spen-mode-pill').click()`. `spen-mode-label` reads `Annotate`, the pill label becomes `S Pen mode: Annotate. Switch to Normal`, and `getByTestId('annotation-tray')` is visible. Click again to return to `Normal`.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/top-nav.spec.ts`), then `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. The video must show the pill moving between dots and the pane following; `final.png` must show the selected dot and its pane.

## Gotchas

- The cold app opens on Orchestra, not Chats. Never assume a tab.
- The pill position is a CSS transform, so assert it from computed style, not from a screenshot.
- The pull-down chevron gesture is not attached on web: dragging down on the nav does nothing. Use the chevron button (see `bridge-pull-sheet.md`).
- Annotate, Voice audio and S Pen hardware are native-only. Web proves only the toggle and tray.
