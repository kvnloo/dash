# Context gauge

A small gauge in the chat shows how full the context window is. Tapping it opens a readable card ("Context window") with a usage bar, categories and a Compact now button, or, for a harness with no native snapshot, the note "This harness has no native context snapshot." The card must sit fully inside the viewport and can be closed.

Status: COVERED by `e2e/mbp-army/army.spec.ts` › "context gauge opens a readable card inside the viewport"; "safe exploratory controls and context hit target at 390"; "safe exploratory controls and context hit target at 800"

## Sub-features

- `gauge-open-card` the gauge opens `Context window details` inside the viewport. [covered: "context gauge opens a readable card inside the viewport"]
- `gauge-no-snapshot-note` the fixture harness shows the no-snapshot note. [covered: "context gauge opens a readable card inside the viewport"]
- `gauge-close` the backdrop or the gauge closes the card. [covered: "context gauge opens a readable card inside the viewport"]
- `gauge-hit-target-narrow-wide` the gauge opens the card at 390 and 800 widths. [covered: "safe exploratory controls and context hit target at 390"; "safe exploratory controls and context hit target at 800"]
- `gauge-categories-compact` category chips and `Compact now`. [UNCOVERED]

## How to get to it (user POV)

- Open a chat and tap the gauge near the composer. Tap outside the card to close it.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- `openChat(page, bridge)`, then one message so the gauge has state: `await send(page,'context card journey')` and wait for `ARMY_REPLY:`.

- **Open.** `const gauge=page.getByRole('button',{name:/^Context window,/}); await gauge.click({noWaitAfter:true})`.
- **Read.** `const card=page.getByLabel('Context window details',{exact:true})`. It is visible and `toBeInViewport({ratio:1})`, and `card.getByText(/This harness has no native context snapshot/)` shows.
- **Close.** If `getByRole('button',{name:'Dismiss usage details',exact:true})` exists, click its corner (`position:{x:8,y:8}`); otherwise click the gauge. The card has count 0.
- **Narrow and wide.** `page.setViewportSize({width:390,height:780})` or `800` before `openChat`; the exploratory test repeats open and close in a seeded order.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "context gauge opens a readable card inside the viewport"`
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. The video must show the card open fully on screen, then closed. `console.json` must show no `PAGEERROR`.

## Gotchas

- Turbo renders the card in a modal whose backdrop covers the gauge, so the gauge cannot close it. Use the backdrop (`Dismiss usage details`) as the close control, as the test's `closeContextCard` does.
- The gauge name carries a suffix (`Context window, approximately N percent` or `, unavailable`), so match it with a regex.
- The fixture harness has no native snapshot, so the gauge is `unavailable` and the card shows only the note. Categories, the usage bar and `Compact now` need a real harness; report them UNCOVERED.
- The exploratory tests are seeded, so which actions run depends on the width; read the trace before claiming a given action was hit.
