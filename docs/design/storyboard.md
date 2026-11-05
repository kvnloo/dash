# Dash UI storyboard

Source refs: `docs/design/references/` (OMP session Grok screenshots + Zero Android video frames).

## Main layout

Three swipe panes, top tabs **Bots | Chats | Orchestra**, bottom `@` search dock.

| Tab | Content |
|-----|---------|
| Bots | Hermes profiles + harness agents |
| Chats | All conversations (Grok History density) |
| Orchestra | Product/project orchestration |

Default tab: **Chats**. Compose in header.

## Reference map

- `REF-grok-history-01/02` → Chats list (date groups, circular avatars, hairlines)
- `REF-grok-chat-01/02/03` → thread (assistant plain, user bubble, + / mic composer)
- `REF-grok-voice` → voice overlay (silver orb, “Say something…”)
- `REF-grok-settings` → grouped settings rows
- `REF-grok-drawer` → side density only; Dash uses top tabs, not a Grok drawer
- `REF-zero-home` / `REF-zero-chizi-grid` / `REF-zero-kit-grid` → Orchestra tile density
- `REF-zero-chat` → Zero thread chrome (black, no cartoon)
- Pattern atlas (T3 / ChatGPT / Grok / Conductor / AODL) → [`ai-ui-patterns/`](ai-ui-patterns/README.md)

## Official designs

Language: [`language.md`](language.md) — pure black `#000`, white accent, user bubble `#1f1f1f`. Matches `app/src/theme.ts`. **Not** graphite/cyan.

| Track | Path | Status |
|-------|------|--------|
| In-repo frames | [`official.html`](official.html) | 9 phones from original brief + refs |
| Paper.design | [`paper/`](paper/) | HTML import; MCP not live |
| Pencil / pen.dev | [`pencil/`](pencil/) | `.pen` 2.17 tokens synced; CLI not logged in |
| Captured frames | [`frames/`](frames/) | PNG crops of each phone |

## Visual rules

- Background `#000000`
- Accent `#ffffff` (tab dot, send, listen CTA)
- Assistant: plain text, no bubble
- User: solid bubble `#1f1f1f`
- Tabs: dot, not underline dash or pill fill
- Search: compact; chips on focus only
- Lists: date sections + hairline rows
- Status: dots, not “Online” pills

## Debug acceptance

`app/src/debug/scenarios.ts` + `screenshots/debug/` — `main-chats`, `main-bots`, `chat-omp`, `chat-streaming`.
