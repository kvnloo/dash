# Identity badge and panel

A badge in the chat window's dock names where the chat runs (host, harness, profile, session, model). Tapping it opens an identity panel with those fields, a model-source line ("Model reported by host..." or "Model unknown...") and the lineage. Tapping again closes it. It must work on a narrow phone (390) and a wider window (800).

Status: COVERED by `e2e/mbp-army/army.spec.ts` › "pairing, Chats tab, open and close real chat window"; "harness picker switches OMP to Hermes without sending"; "safe exploratory controls and context hit target at 390"; "safe exploratory controls and context hit target at 800"
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-02-03-chat-screen-chrome-header-full-screen.spec.ts` › "03.13 identity badge opens the identity panel with host, harness, profile, session and model line"

## Sub-features

- `badge-host` the badge contains the host (`mbp`). [covered: "pairing, Chats tab, open and close real chat window"]
- `badge-harness` the badge follows a harness switch to `Hermes`. [covered: "harness picker switches OMP to Hermes without sending"]
- `panel-open-close` the badge toggles `chat-window-identity`. [covered: "safe exploratory controls and context hit target at 390"; "safe exploratory controls and context hit target at 800"]
- `panel-fields` host, harness, profile, session, model-source and Lineage text. [UNCOVERED]
- `badge-a11y-label` label `Chat identity: host ..., harness ..., profile ..., session ..., model .... Double-tap for details.` [UNCOVERED]

## How to get to it (user POV)

- Open a chat window and tap the badge in the dock, next to the close X.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- `openChat(page, bridge)`; for the wide case call `page.setViewportSize({width:800,height:780})` before it.

- **Read the badge.** `await expect(page.getByTestId('chat-window-badge')).toContainText('mbp')`.
- **Open the panel.** `await page.getByTestId('chat-window-badge').click({noWaitAfter:true})`. `await expect(page.getByTestId('chat-window-identity')).toBeVisible()`.
- **Close it.** Click the badge again. `chat-window-identity` has count 0.
- **Harness switch.** `await chooseHarness(page,'Hermes')`; the badge now contains `Hermes`.
- **Model source (not driven).** `chat-window-model-source` shows one of the two lines in the summary.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "safe exploratory controls and context hit target at 390"` (repeat with `... at 800`).
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. The video must show the panel opening and closing inside the viewport; `console.json` must list no `PAGEERROR`.

## Gotchas

- The exploratory tests pick a seeded random action (context card, badge toggle, close and reopen). Whether the badge is hit in a given run depends on the seed per width, so read the trace to confirm; the pairing test hits the badge deterministically.
- The panel text depends on what the host reports. The fixture usually yields a model-unknown line.
- The badge is not in full-screen chat; only the window dock has it.
- The harness-switch test asserts the badge text, not the panel, so panel fields need their own assertion.
