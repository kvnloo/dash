# Paper.design — Dash official

Paper Desktop MCP is **not running** on this machine (`127.0.0.1:29979` down). These files are the import payload, not a live canvas write.

## Import

1. Install [Paper Desktop](https://paper.design).
2. New file → paste HTML from `dash-official.html` (Paper `write_html` / paste).
3. One artboard per `.phone[data-frame]`.

## Agent prompt (paste into Paper)

```
Import docs/design/paper/dash-official.html.
Use docs/design/language.md tokens (pure black #000, white accent, user bubble #1f1f1f).
9 iPhone 390×844 frames: main-chats, main-chats-search, main-bots, main-orchestra, chat, chat-streaming, pair, settings, voice.
Top tabs Bots | Chats | Orchestra with white underline. Bottom @ search. No bottom nav. No Online pills.
User bubble #1f1f1f. Assistant plain text. Chips only when search is focused.
Match Grok History / Grok Chat / Grok Voice density and Zero product tiles.
```

Source of truth in git: `docs/design/official.html`.
