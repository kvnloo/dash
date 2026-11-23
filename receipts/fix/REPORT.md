# Gmail and voice integration

## Changes

The chat card frame is transparent and the OpenUI wrapper no longer paints a second surface. Invoice highlights start at the subject’s left edge. Dash Gmail puts the app name, query and right-aligned count on one line. The pin ring is hidden in narrow card frames. App Gmail has a dark Material 3 search pill, a Top results heading, higher contrast for unread mail, muted read rows and a decorative star on each row. The fixture has no starred state, so the stars are outlines.

Outside Voice focus, the bubble replaces the live top bar and the window’s call controls. Captions can occupy one short line. The approval peek and the DA-058 fallback line follow the same bubble visibility rule. In focus, the shared card host uses the saved Dash or App style. The scroll area ends above Mute, CC and End, with a fade at its lower edge.

## Three visual passes

1. The first updated captures showed the chat surface continuing around the frame and the highlight lining up with the subject. The App search pill still carried redundant text, and its star column pulled timestamps inward. The voice captures showed a clear gap between the peek and the permission buttons.
2. Aligned the Dash header horizontally and anchored App timestamps and stars at the trailing edge. The updated army checks caught a race between Gmail’s query and heading decoration and the kit’s mount. The focus journey showed that the Gmail footer could be scrolled above the controls.
3. Applied the inbox decoration for both render orders. Compared all five final states for alignment, spacing, clipping and contrast. Dash and App show the full query and result count. The fixture’s single Chats row leaves more open space than the target. The pending peek truncates the fixture title while keeping its instruction and the permission buttons visible. Focus fades the fourth Gmail row at the scroll boundary, and the scrolled capture shows the whole card and footer above the controls.

The supplied target is on the left in each sheet. The real browser capture is on the right.

| Surface | Capture | Comparison |
| --- | --- | --- |
| Gmail in chat, Dash | [Capture](gmail-chat-dash.png) | [Target beside capture](compare-gmail-chat-dash.png) |
| Gmail in chat, App | [Capture](gmail-chat-app.png) | [Target beside capture](compare-gmail-chat-app.png) |
| Live bubble on Chats | [Capture](bubble-chats.png) | [Target beside capture](compare-bubble-chats.png) |
| Live bubble with pending approval | [Capture](bubble-pending.png) | [Target beside capture](compare-bubble-pending.png) |
| Voice focus with approval and Dash Gmail | [Capture](focus-pending.png) | [Target beside capture](compare-focus-pending.png) |
| Voice focus after scrolling to the Gmail footer | [Capture](focus-card-scrolled.png) | |

## Verification

- Combined baseline `94e7a87d` passed typecheck and all four targeted card-style and focus journeys. The first updated pass also passed all four.
- The final target set contains eleven army journeys across card styling and Gallery, the bubble and focus, approvals, streaming captions and main-mic resume. The checks cover query fit, highlight alignment, read and unread styles, the Gmail intent round trip, approval geometry, scrolling past the fade and call control side effects.
- The army ran on macOS with the Expo web export, headless Chromium, a fixture ACP agent and a fixture voice broker. The viewport was 412 × 915 at 2.6×. The documented macOS pass-through adapter substituted for bwrap. Early captures used an OS-assigned identity fixture port. The final run pins all five local listeners to 39811–39815.
- Dash’s repository instructions require army journeys for behavior coverage. Native Android WebView and iOS rendering, on-device touch and real audio/WebRTC remain unverified. Full O15 release coverage remains incomplete.
