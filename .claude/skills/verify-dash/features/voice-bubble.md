# Voice bubble and focus

A live call docks a 58-pixel bubble above the composer. Tap to open Voice focus or hold for mute and end. New approvals show a badge and a short peek. Focus puts the hero orb, caption, approvals and agent cards above the call controls.

Status: COVERED via `e2e/mbp-army/voice-focus.spec.ts` › "voice bubble docks clear of chat controls and opens focus to resolve a pending approval", `e2e/mbp-army/voice-orb.spec.ts` › "live voice bubble follows the call, opens focus and hides for annotation", and `e2e/mbp-army/voice-approvals.spec.ts` › "a sudo request shows on the voice bubble and opens sealed entry from focus".

## Sub-features

- `bubble-dock` Chats, Main, chat composer and permission rects, drag and saved edge [voice bubble docks clear of chat controls and opens focus to resolve a pending approval].
- `bubble-phases` Call phase, focus navigation, mute and annotation visibility [live voice bubble follows the call, opens focus and hides for annotation].
- `focus-approval` Badge, timed peek, existing Gmail card, Allow once and back to the same call [voice bubble docks clear of chat controls and opens focus to resolve a pending approval].
- `focus-sudo` Pending sudo opens the sealed entry [a sudo request shows on the voice bubble and opens sealed entry from focus].

## How to get to it (user POV)

- Open Voice with Expand and start a call on an attached Hermes session. Back leaves the call running.
- Tap the bubble or its short-lived approval peek to open focus.

## Driving it with the tester army

Preconditions: pair with the fixture bridge and use the voice-enabled web export with the authenticated fixture broker.

- **Dock.** Assert `voice-orb-overlay` is 58 pixels wide and disjoint from the composer and permission actions.
- **Focus.** Send the fixture inbox request and then Needs OK. Assert `voice-orb-badge` is 1 and the peek collapses. Tap the bubble and check `voice-focus-cards`.
- **Approve.** Tap `voice-approval-allow` and check the bridge's permission log for `army-allow-once`. Use `voice-focus-back` and confirm the same call is still live.
- **Run.** `army-stack.sh drive <run> 1 e2e/mbp-army/voice-focus.spec.ts`.
- **Proof.** Save the viewport shots, trace, browser results and bridge log. Set `ARMY_ORB_RECEIPTS` to collect the target screenshots in one directory.

## Gotchas

- On macOS, the voice specs use the Hermes database fixture and the pass-through launcher documented in the parity receipts notes. Linux continues to use bwrap and its process fixture.
- Android gesture input, IME, WebView and real audio need native evidence.
