# Steer a running Hermes turn

On a steerable Hermes turn the composer shows a mode row, `Steer the running turn` or `Queue for next turn`, with a button to flip it, and the send button reads Steer or Queue accordingly. The fixture Hermes is not gateway-hosted, so Steer must visibly say it could not deliver instead of losing the text silently.

Status: COVERED by `e2e/mbp-army/army.spec.ts` › "Steer running Hermes turn surfaces unsupported ACP delivery honestly"
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-03-04-composer-controls-chips-and-send-gate.spec.ts` › "04 steerable Hermes turn: mode row toggles Steer/Queue and the next send uses that mode"; `rc3-05-06-delivery-status-queue-and-outbox-pers.spec.ts` › "Steer all now sends the queue as a steer into the running Hermes turn and empties the stack"

## Sub-features

- `steer-send` Steer a running Hermes turn; honest rejection shown [covered: "Steer running Hermes turn surfaces unsupported ACP delivery honestly"]
- `steer-mode-row` toggle `Choose Queue for next turn` / `Choose Steer the running turn`, button label follows [UNCOVERED]
- `steer-all-now` `Steer all now` from the queued stack [UNCOVERED]

## How to get to it (user POV)

- Open a Hermes chat, send a message, and while it runs type the next one; the primary button reads `Steer`.
- Flip the mode row to Queue to hold it for the next turn instead.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- A Hermes chat: `await chooseHarness(page,'Hermes')` after `openChat`.

- **Start.** `await openChat(page,bridge); await chooseHarness(page,'Hermes'); await send(page,'ARMY_HANG steer target')`. `ARMY_STREAM_BEGIN` visible.
- **Steer.** `await composer(page).fill('steer instruction')`; `getByRole('button',{name:'Steer',exact:true})` is visible; click it. A visible message matching the unsupported/not-sent copy appears (the bridge says `This session is not gateway-hosted; steering was not sent.` or the app shows `Steer requires a gateway-hosted Hermes session.` / `Delivery failed`).
- **Mode row.** `getByText('Steer the running turn',{exact:true})`, `getByRole('button',{name:'Choose Queue for next turn',exact:true})`; after the flip `getByText('Queue for next turn',{exact:true})` and the send button reads `Queue`.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "Steer running Hermes turn surfaces unsupported ACP delivery honestly"`
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. They must show the visible rejection text, and `bridge.log` must show no second turn started by the steer.

## Gotchas

- The committed regex is broad (`Steering is|…|Delivery failed|…`); confirm in `final.png` that the text shown is the real rejection, not unrelated output.
- Real steering needs a gateway-hosted Hermes session; the fixture cannot provide one, so success-path delivery ("Steered") is not reachable here.
- OMP chats have no Steer: the button stays Queue (see queue).
- `ARMY_HANG` keeps the Hermes turn running until Stop.
