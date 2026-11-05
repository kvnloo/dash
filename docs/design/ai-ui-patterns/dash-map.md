# Dash relevance

What the catalog implies for this phone app. Tokens and frames stay in [`language.md`](../language.md). This file is the product judgment.

## Already the product

Dash is a **mobile-remote-agent** with a **mobile-chat** chrome. The laptop runs the harness. The phone is the control surface. That is the same job as T3 Code's phone app, not ChatGPT's hosted model.

Shipped on `main` and pinned by tests:

| Pattern | Where | Pin |
|---------|-------|-----|
| `docked-composer` | `Composer` inside `KeyboardDock` | `KeyboardDock.test.ts` |
| `sticky-ime` | S25 edge-to-edge IME | Maestro + KeyboardDock source contract |
| `assistant-plain-text` | Chat thread | `language.md` |
| `user-bubble` | `#1f1f1f` | `theme.ts` |
| `history-date-groups` | Chats pane | Grok History density |
| `top-tabs-not-bottom` | Bots / Chats / Orchestra | `golden-nav.ts` 60px chrome |
| `voice-orb` | Voice screen, "Say something…" | Grok Voice ref |
| `status-dot-not-pill` | Bots / Orchestra | `--ok` / `--faint` |
| `bottom-search-dock` | `@` bar | chips only when focused |
| `rAF-stream` | `store/text.ts` | never per-token in chats store |

AODL encodings already named for Dash: catalog executors `omp,codex,grok,claude,hermes,pi,fx`. Visual efforts and runtime states are the right vocabulary for thinking UI once #27 lands.

## In flight (do not steal)

Claimed PRs as of 2026-09-11:

| Pattern | Issue / PR | Why it maps |
|---------|------------|-------------|
| `live-session-adopt` | #20 / #23 | T3 and OMP both treat a running CLI session as the chat, not a new empty thread |
| `live-transcript-hydrate` | #26 / #30 | Opening a live row must show the jsonl, not a blank composer |
| `slash-live-attach` | #28 / #32 | Composer `/live` is the mobile form of T3's thread list |
| `effort-orbs` | #27 / #31 | AODL effort + runtime-state cadence, not PulseDot |
| `visual-json-avatar` | #21 / #25 | AODL cores instead of letter-in-circle |
| `aodl-orchestra-graph` | #19 / #24 | Orchestra lists the AODL network, not `DEMO_ORCHESTRAS` |
| `self-dev-default` | #29 / #33 | Cold open on Orchestra |

## Take from competitors

These patterns fit the thin-UI ethos and the existing language.

1. **Adopt live sessions.** T3 Code's whole product is "the GUI is not a second agent." Dash already started this (#20/#26/#28). Keep one `sessionId` per harness thread.
2. **Tool status as one line.** Codex desktop, Claude TUI, and Dash `status` events already agree. Do not grow a tool-call accordion on the phone.
3. **Timeout and parse errors as chat errors.** Consumer apps show a red inline failure and keep the composer. Bridge #4 is that contract.
4. **Voice is a full-screen overlay, not a second product.** Grok's circular expand is the existing Dash Voice screen. Gemini Live camera/screen-share is out of scope until a claimed issue assigns it.
5. **BYO harness, do not resell tokens.** T3's "bring your own sub" is Dash ethos #15. The picker lists AODL executors. `o8` and `firstmate` stay out.

## Reject on this phone

| Pattern | Who ships it | Why Dash should not |
|---------|--------------|---------------------|
| `three-pane-desktop` | T3 Code, Claude.ai artifacts | 390px width. History is a pane swipe, not a persistent rail |
| `worktree-per-thread-board` | Conductor, Cursor 3, Superset | Isolation belongs on the laptop (OMP worktrees, firstmate). Phone shows roster + chats |
| `inline-diff-review` | T3 Code, Codex desktop | Review is a laptop job. Phone can later deep-link a PR, not render a split diff |
| `floating-composer` | common mobile chatbot bug | Covers the last token. KeyboardDock is the opposite |
| `bottom-tab-bar` | most consumer apps | Language forbids it. Tabs are top dots |
| `chatgpt-emerald` | ChatGPT | One accent: white on `#000` |
| `hosted-model-picker-as-identity` | ChatGPT, Claude.ai | Dash identity is harness + host, not gpt-4o vs opus |

## Reality

"Reality" is not a coding-agent control plane. The public products with that name are a digital-wellbeing Android app and an iOS task assistant. Neither is a Dash analog. The close analogs for phone-over-laptop-agents are **T3 Code**, **Codex remote**, and **Grok** (chat density + voice orb, which Dash already copied).

If a private Reality mock exists in Kevin's design refs, it is not in this repo's `docs/design/references/` and is not catalogued here.

## Decision tree

Do not argue chrome in a PR without walking [`decisions.json`](ai-ui-patterns/decisions.json). Kind is derived (`lock` / `fork` / `claimed` / `gap`). Case study: [`synergy.md`](ai-ui-patterns/synergy.md). Inventory of every control: [`inventory.md`](ai-ui-patterns/inventory.md).

## Frontier-kb connections

| Frontier node | Dash use |
|---------------|----------|
| `harnesses/omp` | Primary executor. Live tabs become Chats. TUI has no phone chrome; Dash supplies it |
| `harnesses/hermes` | Kanban + gateway. Orchestra and Bots, not `hermes chat -q` as the long-term path (#9) |
| `harnesses/o8` | Desktop control room. Do not spawn. Study its board only as a desktop pattern |
| `harnesses/fx`, `harnesses/pi` | Catalog executors. Adapters on main via #18 |
| `domains/tool-use` | Status line vs tool accordion |
| `domains/frameworks` | Control-plane vs executor split (AODL kinds) |
| `domains/learning-acceleration` | Encode this atlas; do not dump screenshots without ids |
