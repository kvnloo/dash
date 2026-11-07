# Queue and the queued stack

While a turn runs, typing a message and tapping Queue holds it for the next turn instead of sending now. With one or more items, a `N queued` header appears above the composer and expands to a stack where each item can be edited, deleted or drag-reordered. Actions are Merge (preview in the composer, then Save queued merge or Cancel merge), Steer all now (steerable Hermes only), Clear, and a `Deliver queued as one message` switch.

Status: COVERED by `e2e/mbp-army/army.spec.ts` › "Queue preserves next prompt and sends after running turn"
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-05-06-delivery-status-queue-and-outbox-pers.spec.ts` › "RC3 06 queued stack" (several tests) and `rc3-03-04-composer-controls-chips-and-send-gate.spec.ts` › "04 streaming without steer: primary is Queue and the message is queued, not sent"

## Sub-features

- `queue-one` Queue a draft behind a running turn; it sends after the reply [covered: "Queue preserves next prompt and sends after running turn"]
- `queue-header` `1 queued` / `N queued` header toggles the stack [UNCOVERED]
- `queue-edit-delete` edit an item's text (`Queued message 1`), delete it (`Delete queued message 1`) [UNCOVERED]
- `queue-reorder` drag handle `Drag queued message 1` reorders [UNCOVERED]
- `queue-merge` `Merge`, `Merged queue preview`, `Cancel merge`, `Save queued merge` [UNCOVERED]
- `queue-deliver-one` switch `Deliver queued as one message` on/off [UNCOVERED]
- `queue-clear` `Clear` drops all items, never sent [UNCOVERED]
- `queue-steer-all` `Steer all now` on Hermes (see steer) [UNCOVERED]

## How to get to it (user POV)

- Send a message in a chat; while it streams, type the next message and tap `Queue` (the send button is renamed Queue during a turn on non-steerable harnesses).
- Tap the `N queued` header above the composer to open the stack.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Default OMP chat. Use `ARMY_SLOW` (9 s) as the running turn so there is time to queue.

- **Start the running turn.** `await openChat(page,bridge); await send(page,'ARMY_SLOW first queued journey')`. `ARMY_STREAM_BEGIN` visible.
- **Queue.** `await composer(page).fill('second queued journey'); await page.getByRole('button',{name:'Queue',exact:true}).click({noWaitAfter:true})`. The queued text is shown in the transcript and the box clears.
- **Delivered after.** `ARMY_REPLY: second queued journey` appears once the first reply finishes (allow 24 s).
- **Stack controls (uncovered).** `getByRole('button',{name:'2 queued',exact:true})`, `getByRole('textbox',{name:'Queued message 1',exact:true})`, `getByRole('button',{name:'Delete queued message 1',exact:true})`, `getByLabel('Drag queued message 1',{exact:true})`, `getByRole('button',{name:'Merge',exact:true})`, `getByRole('button',{name:'Save queued merge',exact:true})`, `getByRole('switch',{name:'Deliver queued as one message',exact:true})`, `getByRole('button',{name:'Clear',exact:true})`.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "Queue preserves next prompt and sends after running turn"`
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. They must show the queued text in the transcript while the first turn runs, and a second `ARMY_REPLY:` after it (two turns in `bridge.log`, in order).

## Gotchas

- The queue only holds while a turn is running; with `ARMY_HANG` and no Stop it never drains, so prefer `ARMY_SLOW` unless testing the stack.
- The committed test passes if the text merely appears in the transcript; it does not prove the item did not send early. The draft checks the fixture prompt log for that, which the committed fixture does not write.
- On Hermes the send button reads `Steer` by default; pick `Choose Queue for next turn` first (see steer).
- The drag test uses mouse moves on the handle and is timing sensitive; the switch defaults to On (one combined message).
