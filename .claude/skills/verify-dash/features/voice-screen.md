# Voice screen

The Voice screen ("Start voice in Dash") shows the caption "Realtime voice inside Dash", an empty transcript, a label and Back. In the browser there is no z0bridge identity and no microphone, so Start voice reaches an honest error and never goes live.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-10-11-voice-live-surface-annotation-and-lab.spec.ts` › "11.01 Voice screen Start voice in Dash: caption, transcript, label and Back (web reaches the identity error, never live)"

## Sub-features

- `voice-open` Expand opens the Voice screen with its caption and note (web reachable) [UNCOVERED].
- `voice-start-error` Start voice in Dash shows "Pair Dash with z0bridge identity to use voice" and never flips to Stop (web reachable) [UNCOVERED].
- `voice-live` a live call: transcript lines, Mute, "Back to chat · call keeps going" [UNCOVERED] (native only).
- `voice-back` Back returns to the Chats tab [UNCOVERED].

## How to get to it (user POV)

- Tap Expand on the nav row, which opens the Voice screen (heading "Voice", or "Live call" once connected).

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Paired via `pair(page,bridge)`; the web build holds no z0bridge identity.

- **Open.** `page.getByRole('button',{name:'Expand'}).first().click()`; `getByRole('heading',{name:/^(Voice|Live call)$/})` and `getByTestId('voice-caption')` (text `Realtime voice inside Dash`) appear. `getByTestId('voice-transcript')` is attached and `getByTestId('voice-mic-bar')` is absent.
- **Start.** `page.getByRole('button',{name:'Start voice in Dash',exact:true}).click()`. The caption becomes `Pair Dash with z0bridge identity to use voice`; `Stop voice in Dash`, `Mute` and `Back to chat · call keeps going` have count 0.
- **Back.** `getByRole('button',{name:'Back'}).first().click()`; the caption is gone and the tab bar returns.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/voice.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. The screen must show the identity error and no live controls.

## Gotchas

- Real microphone audio, WebRTC and a live z0bridge call need a native army lane. Never drive the owner's phone or adb. Web proves only the error path.
- Entering Voice does not start a call; the pill only appears after the first Start attempt.
- Draft locators all exist in app source (checked by grep).
