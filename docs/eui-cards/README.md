# Ephemeral-ui Gmail card density (DA-096)

Web build captures at 412 × 915 CSS px, 2.6× device scale, headless Chromium. The chat captures come from
`e2e/mbp-army/card-style.spec.ts` with `ARMY_CARD_SCREENSHOTS` pointed here. The reference is the
ephemeral-ui catalog's own inbox demo (`src/demos.html?kind=inbox` at the pinned `KIT_REV`), rendered at the
same size and cropped to the card.

| File | What |
| --- | --- |
| `gmail-dash.png`, `gmail-chat-dash.png` | Gmail inbox card in the Dash style, alone and in the chat |
| `gmail-app.png`, `gmail-chat-app.png` | The same card in the App (Gmail) style |
| `gallery-dash.png`, `gallery-app.png` | Card gallery in each style (Blueprint theme) |
| `catalog-reference-inbox.png` | The catalog's reference rendering |
| `compare-gmail-dash.png`, `compare-gmail-app.png` | Before, after and reference at one scale |

## Measurements (CSS px, card in the chat)

| | Row height | Card height (4 rows) |
| --- | --- | --- |
| Catalog reference (13 px subject, 380 px wide) | 74 | 452 |
| Dash style before | 82–83 | 456 |
| Dash style after | 79–80 | 438 |
| App style before | 82 | 491 |
| App style after | 79 | 473 |

Dash keeps its 15 px phone type and 44 px controls, so rows stay a few pixels taller than the
reference. The loose parts were the 22.5 px sender line, the 10 px row padding and the 12 px gap under the
last row. They are now 20 px, 9 px and 4 px.

Native Android WebView and iOS font rendering were not captured.

## Voice (`voice/`)

Captured by `e2e/mbp-army/voice-bubble-only.spec.ts` with `ARMY_VOICEBAR_RECEIPTS` pointed here.

| File | What |
| --- | --- |
| `voice/chats-bubble-only.png` | Chats list during a live call: the 58 px bubble only, with no voice bar or caption band |
| `voice/focus-dash.png` | Voice focus: 188 px orb, Needs OK card, then the Dash style Gmail card |
| `voice/focus-app.png` | The same in the App style |
