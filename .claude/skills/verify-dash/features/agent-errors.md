# Agent errors

When the agent fails a turn, the user sees the error in the chat instead of silence, the running indicator clears, and the composer works for the next message.

Status: COVERED by `e2e/mbp-army/army.spec.ts` › "real ACP error is surfaced visibly and leaves composer usable"

## Sub-features

- `error-visible` the failure text shows in the chat [covered: "real ACP error is surfaced visibly and leaves composer usable"]
- `error-recover` composer is enabled and the next send gets a reply [covered: "real ACP error is surfaced visibly and leaves composer usable"]
- `error-per-harness` the same on Claude Code, Pi, fx [UNCOVERED] (see harness-send-matrix)

## How to get to it (user POV)

- Send any message the agent fails on; the red error text appears where the reply would.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The fixture agent fails any prompt containing `ARMY_ERROR` with the message `ARMY_EXPECTED_AGENT_ERROR`.

- **Fail.** `await openChat(page,bridge); await send(page,'ARMY_ERROR expose expected agent failure')`. `getByText(/ARMY_EXPECTED_AGENT_ERROR|Agent error|ACP.*error|failed/i).first()` is visible.
- **Recover.** `composer(page).fill('retry after error')`, `Send` is enabled, click it. `ARMY_REPLY: retry after error` appears.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "real ACP error is surfaced visibly and leaves composer usable"`
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`, `console.json`. They must show the error text in the transcript, no Stop button, and then a normal reply to the second message.

## Gotchas

- The committed regex also matches any text containing `failed`; check `final.png` that the text is the agent error, not another failure such as a delivery failure.
- It does not assert the `Stop` button is gone; look at the video or trace.
- The error text comes straight from the agent message; a real harness prints different words.
