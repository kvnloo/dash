# S Pen hover

A hovering S Pen (stylus near the glass, not touching) shows a small accent ring that follows the pen tip. A control under the pen glows. The message under the pen highlights. Hover never presses anything. Touch, mouse and pen contact light nothing, so phones without a pen see no change.

Status: COVERED by `e2e/mbp-army/spen-hover.spec.ts` › "S Pen hover shows a following ring, glows the control and highlights the message under it without pressing"

## Sub-features

- `pen-ring-follows` the ring is centred on the pen tip and follows it. [covered]
- `pen-control-glow` the control under the pen shows `pen-glow`; it clears when the pen moves on. [covered]
- `pen-message-highlight` the message under the pen shows `pen-highlight`; only one at a time. [covered]
- `pen-hover-no-press` hovering Attach does not open the chooser and sends no turn. [covered]
- `pen-mouse-ignored` a mouse hides the ring and never glows a control. [covered]
- `pen-android-native` the Android path (gesture-handler Hover, `TOOL_TYPE_STYLUS`). [UNCOVERED: needs the S25]

## How to get to it (user POV)

- Open a chat with a reply. Hold the S Pen just above the screen and move it over buttons and messages.

## Driving it with the tester army

- `openChat(page, bridge)`, `send(page, ...)`, wait for `ARMY_REPLY:`.
- Pen hover is real Chromium input: `cdp.send('Input.dispatchMouseEvent', {type:'mouseMoved', x, y, pointerType:'pen', button:'none', buttons:0})` through `page.context().newCDPSession(page)`.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/spen-hover.spec.ts`
