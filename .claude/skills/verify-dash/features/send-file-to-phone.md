# Send file to phone

When a finished reply names a file on the host, a `Send <file> to phone` chip appears under it. Tapping it asks the bridge to push the file to the phone and reports the bridge's answer.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-06-07-transcript-rendering-links-tool-rows-.spec.ts` › "07.12 a reply naming a host file shows Send <file> to phone; tapping it reports the bridge result"

## Sub-features

- `ptp-chip` reply mentioning a host path shows `Send <basename> to phone` [UNCOVERED]
- `ptp-result` tap reports the bridge result (`That file is not on the host.` for a missing file) [UNCOVERED]
- `ptp-confirm` native `Send to phone?` confirm before pushing [UNCOVERED] (native only)

## How to get to it (user POV)

- Read a finished reply that names a file path; tap the chip with the phone icon.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The committed fixture agent only echoes the prompt as `ARMY_REPLY: <prompt>`, truncated to 220 characters. A prompt that contains a file path may produce the chip with no extension, which is worth trying first; the draft uses an `ARMY_R07_FILES` scenario from an uncommitted fixture-agent extension.
- The path must not exist on the host so nothing is pushed anywhere; the isolated bridge answers from the real `/share` check.

- **Send.** `await openChat(page,bridge)`; `await send(page,'ARMY_HANG ARMY_R07_FILES send to phone journey')`; wait for `ARMY_FILES_DONE`.
- **Chip.** `const share=page.getByRole('button',{name:'Send army-report.md to phone',exact:true})` is visible and contains `Send to phone`.
- **Tap.** `const d=page.waitForEvent('dialog'); await share.click(); const dlg=await d;` its `message()` is `That file is not on the host.`; `await dlg.accept()`. The chip is enabled again.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/send-to-phone.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`; the log must show the share request answered as not found, with no push.

## Gotchas

- On web the confirm is skipped and the result is a `window.alert`, so the test must register `waitForEvent('dialog')` before the click or the alert is auto-dismissed.
- Native shows `Send to phone?` then `Sent to phone` / `Not sent`; that path is untestable in the web army.
- The chip is disabled while one send is in flight, so do not click two chips in a row without waiting.
- Image files named in a reply also render inline images next to the chip (see `inline-media-artifact-stage.md`).
- A real push needs KDE Connect on the host; never use a real path in a run.
