# Continuous voice pill and chat voice dock

After a voice attempt a voice pill shows the call status. On web the error state offers Retry and an "End voice call and dismiss error" button. In a windowed chat the dock shows the same error note and a Retry Live voice chip, and the window owns the voice controls.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-10-11-voice-live-surface-annotation-and-lab.spec.ts` › "11.02 continuous voice pill: error status, Retry, then End voice call and dismiss error closes the error"; "11.03 windowed chat with a voice error: dock note + Retry Live voice; window owns voice controls (no live controls on web)"

## Sub-features

- `pill-error-retry` error pill shows the note, Retry (named Start voice), no mute [UNCOVERED].
- `pill-end-dismiss` End voice call and dismiss error clears the error to an idle pill [UNCOVERED].
- `dock-retry-live-voice` windowed chat dock note and Retry Live voice [UNCOVERED].
- `pill-live-controls` mute and end while connecting or live [UNCOVERED] (native only).

## How to get to it (user POV)

- Start voice from the Voice screen; the pill follows you across screens.
- Open a windowed chat after a failed attempt: the dock shows the note.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Paired via `pair(page,bridge)`; the web build errors on Start, which is the state under test.

- **Pill.** Open Voice (`getByRole('button',{name:'Expand'}).first()`), click `Start voice in Dash`. `getByTestId('voice-mic-bar')` is visible, `getByTestId('voice-error')` (role alert) reads `Pair Dash with z0bridge identity to use voice`, `getByTestId('voice-retry')` has name `Start voice` and text `Retry`, and `voice-mute` is absent.
- **Retry.** Click `voice-retry`; the same error remains.
- **Dismiss.** `getByRole('button',{name:'End voice call and dismiss error',exact:true}).click()`. The error disappears, `getByTestId('voice-start')` reads `Start` and `getByTestId('voice-phase')` has label `Voice status: idle`.
- **Dock.** After an error, Back, open an owned chat window. `getByRole('alert')` holds the note; `getByRole('button',{name:'Retry Live voice',exact:true})` has text `Retry voice`; the app-wide pill is hidden and `getByTestId('window-voice-controls')` is absent.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/voice.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. Show the error state and the cleared idle pill.

## Gotchas

- Mute and end controls render only for connecting or live calls, which web never reaches. A native army lane is needed.
- A windowed chat hides the pill; assert the dock, not the pill, in that case.
- The retry button's accessible name is `Start voice` while its text is `Retry`.
- Draft locators all exist in app source (checked by grep).
