# Dash design language

Canonical product is **Dash**. Tokens match `app/src/theme.ts` and the original brief: Grok chat density + Zero black, not graphite/cyan.

Source refs: `docs/design/references/` (`REF-grok-*`, `REF-zero-*`).

## Glossary

Use these words exactly, in UI strings, accessibility labels, code and tests. If a thing fits none of them, name it plainly; do not stretch one of these.

| Word | Means | Examples | Not |
|------|-------|----------|-----|
| **Host** | A machine on the tailnet that runs a Dash bridge or is listed by one. | host-b, host-a, `0` | a harness, a bot |
| **Harness** | An agent CLI or runtime installed on a host. Dash starts chats with it. | hermes, omp, codex, claude, grok, pi, fx | a bot |
| **Bot** | A deployed messaging identity that people talk to on a chat platform. The host reports it in `HostInfo.bots`. | a Hermes gateway profile bound to Telegram or Discord, OpenDots, GrokBot | a harness, a Hermes profile with no platform, a session |
| **Session / chat** | One conversation, on the phone or held by a harness on the host. | a live OMP tab, a saved Hermes session | a bot |
| **Agent target** (code only: `AgentTarget`) | Anything Dash can open a chat with: a harness, a Hermes profile or a live session on a host. | | a bot |

Where each lives in the app:

- **Hosts** tab groups deployed bots by host and nests their sessions alongside installed harness targets. A host header keeps its plain host glyph, address, actual counts and online dot. Bot rows retain their name and muted channel-state summary; their identity face is the original synergy.ai Moodie companion, not a dotted-orb recreation.
- **Harnesses** are in the bridge sheet (the chevron in the top bar): "Harnesses on <host>". Tapping one starts a chat with it. The harness picker in Chat chooses the harness for new chats.
- **Sessions** are rows in **Chats**.
- Identity orbs remain the live agent/voice vocabulary in chat and Voice. Bots and known Hermes profile/session rows in the host tree use **Moodie faces** (`BotFace`, `vendor/moodie.ts`): stable profile-key resting expressions, with thinking → thinking, work → focused, done → happy, error → worried and approval → alert. A running gateway alone is not evidence of work. Unknown profile metadata stays unknown; host identity never gets a face. The Component lab has explicitly labelled synthetic profile/expression samples. The port preserves Moodie and bloub's MIT notices in code.
- Profile identity stays visible during every expression: opaque body tones translate synergy.ai's paper/blue/orange/acid palette roles to Living Night text/information/warn/ok tokens. Body tone never changes with work or error state; dark `onAccent` eyes retain contrast. Host-tree faces use a 32px footprint so the blob body, not just its eye marks, remains readable.

## Product

Phone app for coding agents on the laptop (OMP, Codex, Grok, Hermes, Claude).

Main: three full-screen swipe panes under the **top navigation bar** (Expand → Voice · three-dot gel pager for **Hosts | Chats | Orchestra** · Bridge details chevron), **bottom** `@` search dock. Under the bar, the workspace header names the current pane and holds Approvals, compose (pencil) and Settings. Default tab: **Orchestra**. Compose lives in the **header** (pencil), not a FAB. The bar also sits at the top of Chat and Settings.

- **Hosts** — deployed bots per host (see Glossary), collapsible host sections. Status **dot**, never “Online” pills.
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
- Hosts: status **dot** (`--ok` / `--faint`).
- Lists: **Today / Yesterday** sections + hairline rows (Grok History).
- Voice: large silver/white orb, “Say something…” (Grok Voice).
- Orchestra: product cards, agent avatars, active/idle dots. Zero grid density, not cartoon tiles.
- Phone chrome: 390×844, 52px header, safe areas 47 top / 34 bottom.

## Required frames

1. `main-chats` — date-grouped conversations, compose in header, `@` dock
2. `main-chats-search` — same, search focused, chips `@bot @chat @file`
3. `main-hosts` — host sections (collapsible, count), phones, bots, harnesses and sessions, status dots
4. `main-orchestra` — product cards, agent avatars, active/idle
5. `chat` — user bubble, assistant plain, attach + mic composer
5a. `chat-attachments` — composer chips (uploaded, uploading, refused), sent files in the bubble, Send to phone
6. `chat-streaming` — status line, stop
7. `pair` — sonic listen CTA
8. `settings` — grouped rows
9. `voice` — orb + “Say something…”

Sample content: OMP / Grok / Codex / Hermes, “fix the auth bug in login.ts”, host `host-a`, address `100.64.0.1:4747`.

## Pattern atlas

Competitor surfaces (T3 Code, ChatGPT, Grok, Claude, Conductor, Cursor 3, harness TUIs) plus AODL encodings and frontier-kb links live in [`ai-ui-patterns/`](ai-ui-patterns/README.md). Attention case study and inspectable tree: [`ai-ui-patterns/synergy.md`](ai-ui-patterns/synergy.md). Phone UI still follows this language file first. Unknown AODL ids fail closed.

## Non-goals

No invented robot artwork: the owner-requested synergy.ai Moodie/bloub companion is the bot-face source. No generic chatbot chrome. No bottom tab bar (tabs are **top**). No cyan/violet “zerOS” palette — that was invented; host `0` Hermes/zerOS share has GrowTwin previews, not Dash tokens.
