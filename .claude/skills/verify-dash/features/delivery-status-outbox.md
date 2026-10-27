# Delivery status and outbox

Under a sent message the user should see whether it reached the bridge: `Sending`, then `Received by bridge`, then `Started`. If the bridge is down, the message waits as `Queued` in a local outbox and is delivered once after restart. If delivery is unconfirmed the bubble reads `Not sent · Retry` with a `Retry message delivery` button that resends exactly once. Queued sends and drafts survive an app restart.

Status: UNCOVERED (the committed "bridge process death disables Send and restart reconnects" covers only Send disabled while offline and a normal send after restart, not the status labels or the outbox)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-05-06-delivery-status-queue-and-outbox-pers.spec.ts` › "RC3 06 delivery status" (3 tests) and "RC3 06 outbox persistence across restart" (3 tests, including "#222 queued send survives bridge loss and app restart and is delivered exactly once", "#414 oversized draft over the UTF-8 row budget does not crash restart", "reload mid-stream restores prior messages and never leaves a stuck spinner")

## Sub-features

- `status-progress` Sending, Received by bridge, Started on the user bubble [UNCOVERED] (expected FAIL at 2c948dc: not mounted)
- `outbox-offline` send while bridge is down shows `Queued`, delivers after restart [UNCOVERED] (expected FAIL at 2c948dc: Send is disabled offline)
- `not-sent-retry` frozen bridge shows `Not sent · Retry`, Retry resends once [UNCOVERED] (expected FAIL at 2c948dc: not mounted)
- `outbox-survives-restart` queued send survives bridge loss and app reload, delivered once [UNCOVERED]
- `oversized-draft-restart` a ~600 KB draft does not crash the restart [UNCOVERED]
- `reload-mid-stream` reload during a running turn keeps prior messages, no stuck Stop [UNCOVERED]

## How to get to it (user POV)

- Send any message and watch the line under the user bubble; stop the bridge, or reload the browser, to see the offline paths.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Hold-and-release of a turn (`ARMY_HANG ARMY_HOLD_<tok>` plus an `army-release-<tok>` file), the prompt log (`fixture-prompts.jsonl`) and `SIGSTOP` of the bridge are draft-only; the committed fixture agent writes none of the files. Offline tests use `bridge.stop()` / `bridge.start()`.

- **Status.** `await openChat(page,bridge); await send(page,'ARMY_HANG ARMY_HOLD_x delivery status')`; `page.getByTestId('delivery-status').last()` contains `Started` and `The bridge reported that execution started; completion is not implied.`
- **Outbox.** `await bridge.stop()`, fill the box, click `Send` (it must be enabled); status contains `Queued` and `Waiting in the local outbox to be sent to the bridge.`; `await bridge.start()` then it becomes `Received by bridge` or `Started` and one `ARMY_REPLY:` appears.
- **Retry.** Freeze the bridge with `SIGSTOP`; after the deadline `Not sent · Retry` and `Delivery is unconfirmed.`; `getByRole('button',{name:'Retry message delivery',exact:true})`; after click, exactly one reply and one prompt on the bridge.
- **Restart.** Queue behind a held turn, `bridge.stop()`, reload (`page.reload`, tab `nth(1)`, `chatRow(page)`), `bridge.start()`; `localStorage` holds the text before reload; reply count 1.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/delivery-status.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. They must show the status labels, and the side effect: exactly one turn for the text in the bridge's prompt log or `bridge.log` after delivery or retry.

## Gotchas

- Confirmed in source at this checkout: `components/DeliveryStatus.tsx` (testIDs `delivery-status`, `delivery-retry`), `store/outbox.ts`, `lib/outbox-storage.ts` and `lib/storage-row-budget.ts` have no importer outside tests, and `bridge/index.ts` does not import `delivery-ledger.ts`. The status, offline outbox and Retry tests are expected FAIL at 2c948dc ("not mounted"). Report them failing.
- Offline, Send is disabled at this commit, so `outbox-offline` fails at the enabled assertion; the committed "bridge process death disables Send…" test asserts that current behaviour.
- `SIGSTOP` needs the bridge's host PID, found through `/proc` by HOME; it works only on the same host as the test.
- Web reload is the app-restart stand-in; native process kill is not covered.
- Oversize draft: the test string is about 600 KB; if neither a note nor truncation appears, the draft was silently dropped.
