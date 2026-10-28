# Composer chips and bedtime capture gate

The RC3 design adds a `composer-primary-action` Send/Queue/Stop button, stat chips (a `tok/s` rate in a reserved slot while streaming, a model chip) and a bedtime capture mode where Send becomes `Save for tomorrow`. At 2c948dc none of this is wired into the screen, so these journeys are expected to fail.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-03-04-composer-controls-chips-and-send-gate.spec.ts` › "04 RC3 primary action carries testID composer-primary-action (expect FAIL at 2c948dc: ComposerPrimaryAction has no importer)"; "04 RC3 #396/#416 tok/s chip in the reserved rate slot while streaming (expect FAIL at 2c948dc: not mounted)"; "04 RC3 #396 model chip shows the host-reported model (expect FAIL at 2c948dc: ComposerStatChips not mounted)"; "04 RC3 #417/#413 bedtime capture mode gates Send into the overnight queue (expect FAIL at 2c948dc: capture-gate has no importer)"

## Sub-features

- `primary-action-testid` button has `data-testid=composer-primary-action`, `aria-label=Send` [UNCOVERED] (expected FAIL at 2c948dc)
- `rate-chip` `composer-stat-rate-slot` then `composer-stat-rate` reads `NN tok/s` while streaming [UNCOVERED] (expected FAIL at 2c948dc)
- `model-chip` `composer-stat-model` shows the host model [UNCOVERED] (expected FAIL at 2c948dc)
- `bedtime-gate` with Bedtime capture turned on in Settings, between 9:30 pm and 7:30 am (phone clock) Send reads `Save for tomorrow`, saves the text on the phone and does not reach the agent; `Send anyway` sends one message; the morning composer offers `Saved last night: …` with Use/Dismiss; off by default (shadow: Send still sends). Covered by "04 RC3 #417/#413 bedtime capture mode gates Send into the overnight queue", "04 bedtime capture: Send anyway sends one message now, then Send saves for tomorrow again", "04 bedtime capture is off until the owner opts in: at bedtime Send still sends" in `rc3-03-04-composer-controls-chips-and-send-gate.spec.ts`

## How to get to it (user POV)

- Chips: visible above the composer while a turn streams. Capture gate: open a chat late at night and tap the send button.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Model chip needs a Hermes bridge with a native context snapshot (`DASH_HERMES_PYTHON` fixture script, as the draft sets up). Rate chip needs a fixture that emits token counts (`ARMY_TOKENS` is not in the committed fixture agent).
- Bedtime gate: `page.clock.install({time:<01:30 today>})` before `openChat`.

- **Primary action.** `composer(page).fill('primary action testID')`; `page.getByTestId('composer-primary-action')` visible with `aria-label` `Send`.
- **Rate chip.** `send(page,'ARMY_SLOW ARMY_TOKENS rate chip journey')`; `getByTestId('composer-stat-rate-slot')` visible, then `getByTestId('composer-stat-rate')` matches `/^≈?\d+(\.\d+)? tok\/s$/`.
- **Model chip.** `getByTestId('composer-stat-chips')`, `getByTestId('composer-stat-model')` contains the model name.
- **Bedtime.** Settings › `Bedtime capture` On, then `composer.fill('bedtime capture journey')`; `getByRole('button',{name:'Save for tomorrow',exact:true})` visible; click; text like `Capture-only mode` or `Saved for tomorrow`; no prompt reaches the fixture.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/composer-chips.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. A failing run must show the element absent at this commit; a passing run shows the chip or the gate and no turn for the captured text in `bridge.log`.

## Gotchas

- Confirmed in source at this checkout: `ComposerPrimaryAction.tsx`, `ComposerStatChips.tsx` and `lib/capture-gate.ts` have no importer outside tests, and `Composer.tsx` renders its own send button. All four journeys are expected FAIL at 2c948dc ("not mounted"); report them as failing, never weaken them.
- `composer-controls` and `composer-field` testIDs do exist (`Composer.tsx`).
- The bedtime test needs the clock installed before page load; set it before `pair`.
