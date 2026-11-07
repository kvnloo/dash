# Composer: type and Send

In a chat the user types in the `Message` box, taps Send, sees their message land in the transcript and the agent's reply stream in. The box's placeholder tells them the state: the harness name, "Queue next message…" while a turn runs, "Queue another (N)…" with queued items, "Waiting for the bridge…" offline. When the host is offline or the chat has ended, the composer and Attach are disabled.

Status: COVERED by `e2e/mbp-army/army.spec.ts` › "composer typing, Send and streamed ACP reply"
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-03-04-composer-controls-chips-and-send-gate.spec.ts` › "04 type in Message and tap Send: user message lands and fixture reply streams"

## Sub-features

- `send-stream` type, Send, user bubble, streamed reply, composer clears [covered: "composer typing, Send and streamed ACP reply"]
- `placeholder-state` placeholder shows harness name, `Queue next message…`, `Queue another (1)…`, `Waiting for the bridge…`, `Reply to session…` [UNCOVERED]
- `offline-disabled` Send and `Attach file` disabled while the bridge is down, draft kept [UNCOVERED] (the offline Send-disabled part is touched by "bridge process death disables Send and restart reconnects", which is the delivery-status-outbox feature)
- `target-error` ended host chat disables the composer with "This chat has ended on the host. Its saved history is still on this phone." [UNCOVERED]

## How to get to it (user POV)

- Chats tab, tap a chat row (or `New chat`), then use the `Message` box at the bottom of the chat window.
- Enter on the keyboard also submits.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Nothing else: each test gets its own bridge with the scripted fixture agent. Fresh `New chat` defaults to OMP.

- **Open.** `await openChat(page,bridge)`. A chat window with the `Message` textbox is in view.
- **Send.** Type and tap Send. `await composer(page).fill('ARMY_SLOW hello streamed UI'); await page.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true})` (or `await send(page,'ARMY_SLOW hi')`). The user message lands, `ARMY_STREAM_BEGIN` appears, the button becomes `Stop`, and after about 9 s `ARMY_REPLY: <prompt>` appears and `Send` is back.
- **Placeholder.** `await composer(page).getAttribute('placeholder')`. Idle `Message <Harness>`; while streaming `Queue next message…`; after one Queue `Queue another (1)…`; after `bridge.stop()` `Waiting for the bridge…`. Source: `app/src/screens/composer-placeholder.ts`.
- **Offline.** `await bridge.stop()`, then expect `getByRole('button',{name:'Send',exact:true})` and `getByRole('button',{name:'Attach file',exact:true})` disabled and the draft still in `composer(page)`.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "composer typing, Send and streamed ACP reply"`
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`, `action-metrics.json`. They must show the user bubble, the streamed `ARMY_REPLY:` text, `Send` restored, and in `bridge.log` one turn for the prompt.

## Gotchas

- `ARMY_SLOW` replies after 9 s, so allow an 18 s timeout on `ARMY_REPLY:`; a plain prompt replies in about 350 ms and the `Stop` button may never be observable.
- The committed test does not assert the composer clears or the placeholder text; those sub-features need extra assertions (see the draft).
- The draft's `composer-controls` / `composer-field` testIDs exist at this checkout (`Composer.tsx`); `composer-primary-action` does not (see composer-chips-and-capture).
- Draft "open-in host placeholder, then target error" needs a fixture holder PID file (`army-holder.pid`) and `army-rpc-methods.jsonl`, which are not in the committed `fixtures.ts`/`fixture-agent.ts`. Expect it to fail on committed fixtures.
