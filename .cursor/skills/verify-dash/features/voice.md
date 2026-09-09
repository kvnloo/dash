# Voice

Expand (left of the pager) opens Voice. The phone records, the laptop transcribes with sherpa, a harness answers, the phone speaks.

## Sub-features

- `voice-open` is the expand control → Voice screen.
- `voice-hear` is laptop STT of an utterance.
- `voice-speak` is TTS of the reply.

## How to get to it (user POV)

- Tap expand on AppNav.
- Direct route Voice.

## Driving it with control-dash

Preconditions:

- Mic permission on the phone.
- Bridge speech warmup succeeded (see `dash-pair` logs).

- **Open.** Debug navigate to Voice, or phone tap expand.
- **Live utterance.** Human holds the phone to speak. Do not fabricate audio in CI.
- **Proof.** Voice screen caption moves idle → hearing → thinking → speaking, or a `transcript` event in bridge logs.

## Gotchas

- Expo Go Android recordings are not raw WAV. Live STT is laptop-side after upload, not `decodePairCodeFromWav` on device.
- Debug web cannot prove mic capture.
