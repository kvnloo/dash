# Dash voice bubble and focus

The previous live overlay centered a 256-pixel hit area over the app. The new 58-pixel bubble sits in the keyboard-aware dock on Main, Chats and chat windows. A chat gives the bubble a row above its permission cards and composer. The bubble uses the existing orb style and a phase ring, saves the nearest edge after a drag, opens focus on tap, and exposes Mute and End on hold.

Voice focus puts the 188-pixel orb, call status and live caption above a scrollable approval and agent-card stack. Mute, CC and End sit below the scroll area. Needs OK uses the existing one-time permission path. Sudo still requires the sealed password entry. Agent cards from the call's Hermes chat or broker replies use the existing EphemeralCard host.

The top pill stays because it offers status, CC and immediate Mute and End without entering focus. Chat windows keep those quick controls in their dock. The bubble owns the approval badge and five-second peek on ordinary surfaces. The DA-058 approval line is still available when Learn or annotation hides the bubble. Focus uses full-size approval cards and the same spoken commands.

## Visual review

| State | Review |
| --- | --- |
| Main | The right edge lines up with the composer. The bubble has a separate row from the attached-session actions. |
| Chats | The bubble clears the roster and leaves the tab and list controls accessible. The fixture has one Hermes row. |
| Chat | The dock leaves space for the composer input, its model controls and the chat header. |
| Pending | A red badge stays legible against the ring. The long fixture title ellipsizes while the action remains visible. Both chat permission buttons stay unobstructed. |
| Focus with approval | The hero, status, caption and approval actions remain visible. The Gmail card uses its full existing interactive surface and scrolls when needed. |
| Focus after Allow | The approval disappears after the bridge resolves it. The card and fixed call controls remain visible. |

Pass 1 established the dock alignment and caught a clipped peek action and a focus capture during the entrance animation. Pass 2 kept the action visible and captured the settled focus layout. Pass 3 refined the glow, focus contrast, action size and End button. The comparison sheets place the supplied target on the left and the actual fixture capture on the right. The before/after sheet starts with the supplied pre-change image.

## Verification

- Baseline `28eb3deb`: typecheck passed and the five existing orb and approval army journeys passed with the macOS Hermes fixture.
- Orb lane: typecheck passed and six targeted army journeys passed. The updated journeys retain checks for phase changes, orb style restore, annotation, spoken Allow once, the exact bridge decision and sealed sudo. The new phone-sized journey covers all screenshot states, position and collision rects, peek expiry, focus cards, edge persistence, and the hold menu.
- The repository requires army journeys as its test suite. Bubble phases, approval badge and docking are exercised there.
- Headless Chromium used a 412 × 915 viewport at 2.6×. The real Expo web export was paired with an isolated Bun bridge, scripted ACP agent and authenticated voice broker. On macOS, a pass-through bwrap shim launches the bridge and preserves the seeded Hermes database fixture. The OMP process fixture and Linux PID isolation require Linux.
- Native Android WebView rendering, IME and safe areas, physical touch gestures, and real audio/WebRTC remain unverified. This was a targeted army run. O15 release coverage remains incomplete.
