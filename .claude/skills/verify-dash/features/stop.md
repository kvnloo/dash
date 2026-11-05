# Stop a running turn

While the agent is replying, the send arrow becomes a Stop button when the draft is empty. Tapping it cancels the turn on the host, the streaming indicator goes away, and the composer is usable again for the next message.

Status: COVERED by `e2e/mbp-army/army.spec.ts` › "Stop cancels an active ACP turn and restores composer"
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-03-04-composer-controls-chips-and-send-gate.spec.ts` › "04 streaming with empty draft: Stop sends a cancel and streaming stops"

## Sub-features

- `stop-cancel` tap Stop on a hung turn, indicator clears, composer re-enabled, next send answered [covered: "Stop cancels an active ACP turn and restores composer"]
- `stop-empty-draft` Stop is the primary action only when the draft is empty; with text it is Queue or Steer [UNCOVERED] (the committed test starts from an empty draft but does not assert the swap)
- `stop-cancel-reaches-agent` the host agent receives `session/cancel` [UNCOVERED] (draft reads a log the committed fixture does not write)

## How to get to it (user POV)

- Send a message, and while the reply streams tap the square Stop button where Send was (accessible name `Stop`).

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Default OMP chat; the fixture agent hangs on `ARMY_HANG`.

- **Start a hanging turn.** `await openChat(page,bridge); await send(page,'ARMY_HANG cancel this')`. `ARMY_STREAM_BEGIN` appears and `Stop` is visible.
- **Stop.** `await page.getByRole('button',{name:'Stop',exact:true}).click({noWaitAfter:true})`. `getByRole('button',{name:'Stop',exact:true})` goes to count 0.
- **Recover.** `await composer(page).fill('after cancel')`, `Send` enabled, click it. `ARMY_REPLY: after cancel` appears.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "Stop cancels an active ACP turn and restores composer"`
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. They must show the hung turn ending after Stop (no spinner or Stop button), then a fresh `ARMY_REPLY: after cancel` on the same chat.

## Gotchas

- `ARMY_HANG` never finishes by itself; a failed Stop leaves the test waiting on the Stop count, so a timeout there means the cancel never reached the bridge.
- Stop appears only when the draft is empty. If text is in the box the button reads `Queue` (or `Steer`), so clear the box first.
- The draft's `session/cancel` check reads `army-rpc-methods.jsonl`, which the committed `fixture-agent.ts` does not write; it will not pass on committed fixtures.
