# Mic: dictation and Live voice

The mic button in the composer has two modes. Tap it to dictate: a `Stop dictation` control appears while it listens, and on failure a `Retry dictation` button. Press and hold, then slide up, to switch the mic to `Live voice`; the chosen mode becomes the mic's icon.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-03-04-composer-controls-chips-and-send-gate.spec.ts` › "04 mic tap starts dictation (Stop dictation), and a transcription error shows Retry dictation"; "04 mic hold and slide up switches the mic to Live voice"; "04 mic long-press switches the thumb side (handedness)"

## Sub-features

- `mic-dictate` tap mic, `Stop dictation` appears, then `Retry dictation` on transcription error [UNCOVERED]
- `mic-live-switch` hold and slide up, mic becomes `Live voice` [UNCOVERED]
- `mic-thumb-side` long-press switches the thumb side [UNCOVERED] (expected FAIL, see Gotchas)

## How to get to it (user POV)

- Tap the mic at the right of the composer controls; hold it and slide up to change mode.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Dictation needs a fake capture device: run the test with Chromium args `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` and `context.grantPermissions(['microphone'],{origin:web})`. The isolated bridge sets `DASH_STT_MODEL` to a missing file, so transcription must fail.

- **Dictate.** `const mic=page.getByTestId('composer-controls').getByRole('button',{name:'Dictate',exact:true}); await mic.click({noWaitAfter:true})`. `getByRole('button',{name:'Stop dictation',exact:true})` appears with `Preparing microphone…` or `Listening · tap Stop when finished`.
- **Fail visibly.** Click `Stop dictation`; `getByRole('button',{name:'Retry dictation',exact:true})` and an alert appear (no speech model).
- **Live voice.** `const box=await mic.boundingBox()`; `mouse.move` to centre, `mouse.down()`, wait 450 ms, `mouse.move` up 60 px in 8 steps, `mouse.up()`. `controls.getByRole('button',{name:'Live voice',exact:true})` is visible.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/dictation-mic.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. They must show the Stop dictation control, the Retry state with an alert, and the mic relabelled `Live voice`.

## Gotchas

- Real microphone audio, native permission prompts and IME are native-lane only; the fake device exercises the web path only.
- `getByRole('button',{name:'Dictate'})` exists only while the mic is in dictate mode; after the switch it is named `Live voice`.
- Thumb-side long-press: `MicButton.tsx` at this checkout handles hold as a mode switch and does not take a handedness input, so the draft's handedness check (`dash.settings.v1`) is expected to FAIL at 2c948dc.
- The mic-mode choice persists in storage between tests only within one browser profile; each test gets a fresh profile.
