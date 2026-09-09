# Dash UI storyboard

Source refs: `docs/design/references/` (OMP session `2026-09-09T04-57-13-317Z` + Zero video frames).

## Main layout

Three swipe panes, top tabs **Bots | Chats | Orchestra**, bottom `@` search dock.

| Tab | Content |
|-----|---------|
| Bots | Hermes profiles + harness agents |
| Chats | All conversations (Grok History density) |
| Orchestra | Product/project orchestration |

Default tab: **Chats**.

## Reference map

See filenames in `docs/design/references/` — `REF-grok-*` for chat/history/settings/voice, `REF-zero-*` for Zero Android home/chat grids.

## Visual rules

- Background `#000`
- Assistant: plain text, no bubble
- User: dark bubble `#1f1f1f`
- Tabs: underline, not pill fill
- Search: compact; chips on focus only
- Lists: date sections + hairline rows

## Debug acceptance

`app/src/debug/scenarios.ts` + `screenshots/debug/` — `main-chats`, `main-bots`, `chat-omp`, `chat-streaming`.
