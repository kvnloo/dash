# Dash design language

Canonical product is **Dash**. Tokens match `app/src/theme.ts` and the original brief: Grok chat density + Zero black, not graphite/cyan.

Source refs: `docs/design/references/` (`REF-grok-*`, `REF-zero-*`).

## Product

Phone app for coding agents on the laptop (OMP, Codex, Grok, Hermes, Claude).

Main: three full-screen swipe panes, **top** tabs **Bots | Chats | Orchestra**, **bottom** `@` search dock. Default tab: **Chats**. Compose lives in the **header** (pencil), not a FAB.

- **Bots** — Hermes profiles + harness agents. Status **dot**, never “Online” pills.
- **Chats** — all conversations, Grok History density: date groups, circular avatars, 1-line preview.
- **Orchestra** — product / project mesh (Zero tile density, Dash cards).

Chat: Grok/Zero rules. Pair: sonic + Tailscale. Settings: grouped rows.

## Tokens

| Token | Value | Use |
|-------|-------|-----|
| `--bg` | `#000000` | screen |
| `--surface` | `#121212` | search dock, cards |
| `--elevated` | `#1c1c1c` | raised rows |
| `--bubble` | `#1f1f1f` | user message |
| `--border` | `#262626` | hairlines |
| `--text` | `#f2f2f2` | primary |
| `--muted` | `#8b8b8b` | meta, inactive tabs |
| `--faint` | `#5a5a5a` | placeholders |
| `--accent` | `#ffffff` | active tab dot, send |
| `--on-accent` | `#000000` | text on white buttons |
| `--ok` | `#34c759` | online / active |
| `--warn` | `#ffb020` | paused |
| `--danger` | `#ff6b6b` | error |
| `--radius-sm` | `10px` | chips |
| `--radius-md` | `16px` | rows |
| `--radius-lg` | `22px` | cards, composer |
| `--radius-pill` | `999px` | send, listen |
| `--phone-w` | `390px` | |
| `--phone-h` | `844px` | |

Typography: system sans. Display 22/700. Heading 17/600. Body 16/24. Small 13/18. Label 12/600 uppercase +0.6 tracking. Mono for addresses/tokens.

## Visual rules

- Background is **pure black** `#000`. One accent: white.
- Assistant: **no bubble** — left-aligned plain text (Grok).
- User: solid `#1f1f1f` bubble, ~22px radius, tighter bottom-right.
- Tabs: text + **white dot**, not underline dash, not pill fill, not cyan.
- Search: compact `@` bar at the **bottom**. Scope chips **only when focused**.
- Bots: status **dot** (`--ok` / `--faint`).
- Lists: **Today / Yesterday** sections + hairline rows (Grok History).
- Voice: large silver/white orb, “Say something…” (Grok Voice).
- Orchestra: product cards, agent avatars, active/idle dots. Zero grid density, not cartoon tiles.
- Phone chrome: 390×844, 52px header, safe areas 47 top / 34 bottom.

## Required frames

1. `main-chats` — date-grouped conversations, compose in header, `@` dock
2. `main-chats-search` — same, search focused, chips `@bot @chat @file`
3. `main-bots` — harness sections, status dots, role + 1-line desc
4. `main-orchestra` — product cards, agent avatars, active/idle
5. `chat` — user bubble, assistant plain, attach + mic composer
6. `chat-streaming` — status line, stop
7. `pair` — sonic listen CTA
8. `settings` — grouped rows
9. `voice` — orb + “Say something…”

Sample content: OMP / Grok / Codex / Hermes, “fix the auth bug in login.ts”, host `mbp`, address `100.64.0.1:4747`.

## Non-goals

No cartoon robots. No generic chatbot chrome. No bottom tab bar (tabs are **top**). No cyan/violet “zerOS” palette — that was invented; host `0` Hermes/zerOS share has GrowTwin previews, not Dash tokens.
