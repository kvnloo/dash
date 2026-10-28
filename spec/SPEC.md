# Dash specification

Generated from `spec/features.yaml` (baseline `cfc08de`, 2026-10-25). Do not edit by hand: change the ledger and run `python3 spec/render.py`, then `python3 spec/check.py`.

Status is read from the code at the baseline. A requirement is proved only by its device journey (exact-SHA receipt, virtual-monitor E2E or S22/S25 native run), never by a unit test or a report.

## Summary

- Features: 121
- Status from code: implemented 46, partial 49, missing 26
- Priority: P0 51, P1 33, P2 37
- Device journeys: 51

Ledger laws (enforced by `spec/check.py`): every feature has a defined journey; `missing` means no surface_refs (gap locations go in gap_refs); every non-missing feature cites code that exists at the baseline; an ask the owner repeated (`recurring`) is P0; every owner turn in the replay manifest (`spec/replay.yaml`) is cited by a feature, and every cited turn is in the manifest.

## P0 features

| Id | Feature | Status | Journey |
|---|---|---|---|
| DF-001 | Load every chat from every harness on every host | **partial** | `J-chat-list-all-harnesses` |
| DF-002 | Fast search across all chats | **partial** | `J-chat-search-fast` |
| DF-003 | Current live Hermes and OMP sessions shown; stale ones flagged | **partial** | `J-chat-list-all-harnesses` |
| DF-004 | Bridge-owned running chat must not show ended | **MISSING** | `J-send-receive-omp` |
| DF-005 | Continue the exact desktop session from the phone | implemented | `J-send-receive-hermes` |
| DF-011 | Messages send reliably and delivery state is true | **partial** | `J-send-failure-retry` |
| DF-012 | Failed sends are recoverable with Retry | **MISSING** | `J-send-failure-retry` |
| DF-013 | OMP messaging works like Hermes | **partial** | `J-send-receive-omp` |
| DF-014 | Stuck turns diagnosable and unstickable without killing the process | **partial** | `J-steer-queue-merge` |
| DF-016 | PC reachable from Dash across reboots; phone stays connected | **MISSING** | `J-reconnect-reboot` |
| DF-024 | Drafts persist across restarts and crashes | implemented | `J-composer-draft-restore` |
| DF-027 | Slash and @ suggestions work on Main and inside a chat | **partial** | `J-composer-suggestions` |
| DF-035 | Opening a chat shows its real transcript; panes never empty | implemented | `J-chat-open-history` |
| DF-037 | Chat opens as a full-screen window with cutout pill, attached dock and handed X | implemented | `J-chat-window-open-close` |
| DF-039 | Context window inspection works | **partial** | `J-context-card` |
| DF-040 | Prompt quick-scroll rail with previews and jump to latest | implemented | `J-prompt-rail` |
| DF-042 | Markdown, syntax highlighting and descriptive tool rows | implemented | `J-markdown-code` |
| DF-044 | Chat information density: diagrams visible, little forced expansion, useful previews | **partial** | `J-thinking-tools-details` |
| DF-046 | Compact live popup and subagent tree inside the chat | **partial** | `J-subagent-indicator` |
| DF-048 | Thinking orbs wired into chat and voice states | implemented | `J-voice-live-call` |
| DF-050 | Hermes profile faces from the real Moodie source | implemented | `J-bots-tree` |
| DF-052 | Generated UI renders as working native UI with a loader | **partial** | `J-genui-render` |
| DF-054 | Ripple ephemeral UI and fx0 live surface in Dash and web | implemented | `J-live-surface` |
| DF-055 | Inline Ripple roadmap with per-feature progress | **partial** | `J-roadmap-inline` |
| DF-057 | Live voice call works inside Dash | **partial** | `J-voice-live-call` |
| DF-058 | In-app dictation that stays inside Dash | implemented | `J-voice-dictation` |
| DF-061 | z0live screen understanding and in-app control | **MISSING** | `J-z0live-service` |
| DF-065 | S Pen annotation with visible ink, fast entry and working mic | **partial** | `J-annotation-spen` |
| DF-066 | S Pen button toggles annotation and normal mode | **MISSING** | `J-annotation-spen` |
| DF-069 | Turbo mode: talk, mark up with S Pen, fix immediately, see it on the phone | **partial** | `J-dogfood-loop` |
| DF-070 | Turbo via Luna + uiautomator2: parallel ChatGPT chats on the S22 | **MISSING** | `J-turbo-chatgpt-fanout` |
| DF-071 | Tell the owner what to test and take him to that screen | **MISSING** | `J-turbo-preview-brief` |
| DF-072 | Requested changes reach the phone via Metro fast refresh and a preview branch | **partial** | `J-turbo-preview-brief` |
| DF-073 | Dogfood self-test mode | **partial** | `J-dogfood-loop` |
| DF-075 | Bugs blocking live Dash use are priority one | **MISSING** | `J-process-audit` |
| DF-076 | Watch agent auto-attaches while Dash is used | **MISSING** | `J-watch-agent` |
| DF-077 | Real tests before done; Bend laws keep work going; E2E on a virtual monitor | **partial** | `J-process-audit` |
| DF-078 | Exhaustive source-linked spec matching the real surface | implemented | `J-process-audit` |
| DF-086 | Lazy loading and JIT UI so chat lists never lag | **partial** | `J-perf-profile` |
| DF-088 | Whole app is fast: no 2 fps lag, no leak, loops gated | **partial** | `J-perf-profile` |
| DF-092 | Orchestration tree and graph views with real semantics | implemented | `J-orchestra-views` |
| DF-093 | Agent trace is live and shows ask, intent contract, receipts and artifacts | **partial** | `J-trace-live` |
| DF-105 | Pair once: sound or magic link, shared z0bridge identity, agent onboarding | **partial** | `J-pairing-fresh` |
| DF-108 | Navigation predictable; top bar kept; Chat vs Live surface unambiguous | implemented | `J-chat-window-open-close` |
| DF-110 | Bots page collapsible by host with correct vocabulary | implemented | `J-bots-tree` |
| DF-113 | Preserve Dash's black/gold liquid-glass design language | implemented | `J-design-conformance` |
| DF-114 | Dash is the agent control plane, not infra dashboards | implemented | `J-design-conformance` |
| DF-115 | Mobile-native gestures and proactive next action | **partial** | `J-design-conformance` |
| DF-116 | Compact layouts that fit the S25 | **partial** | `J-design-conformance` |
| DF-117 | Presence is not controllability; no demo data as live work | **partial** | `J-orchestra-views` |
| DF-119 | Phone-native app instead of a separate website; every page works | **partial** | `J-design-conformance` |

## Features by area

### Chat roster, sessions and search

#### DF-001 Load every chat from every harness on every host

**partial** · P0 · recurring · journey `J-chat-list-all-harnesses` · claimed partial

**Acceptance.** Dash lists every chat/session from every catalog harness (Hermes all profiles, OMP, Codex, Claude, Grok, pi, fx) on every paired or tailnet host, running and finished. The host is the source of truth; Dash keeps only a bounded disposable cache.

Code: `app/src/lib/live-sessions.ts:27`, `app/src/lib/live-sessions.ts:31`, `bridge/src/roster.ts:419`, `bridge/src/roster.ts:245`, `bridge/src/hermes-sessions.ts:19`, `app/src/store/conversation-persistence.ts:12`

Note: Only host.self agents are adopted (live-sessions.ts:27); remoteAgents is never populated (roster.ts:36,424); Hermes is capped at 50 recent sessions per profile (hermes-sessions.ts:19); OMP rows come only from running processes (roster.ts:245); Codex/Claude finished sessions are not enumerated.
Sources: owner task brief 2026-10-25, hermes-telegram 2026-10-25T17:22, H-014, C-010, recurring-complaints-hermes#9

#### DF-002 Fast search across all chats

**partial** · P0 · journey `J-chat-search-fast` · claimed unknown

**Acceptance.** Search over every chat title and message body, including host-side transcripts not cached on the phone, returns results within 200 ms of the last keystroke and opens the exact session.

Code: `app/src/lib/global-search.ts:62`, `app/src/lib/global-search.ts:214`, `app/src/components/GlobalSearchBar.tsx:43`

Note: Search is an in-memory scan of locally cached conversations and the current roster; there is no host-side index or transcript search route in the bridge.
Sources: owner task brief 2026-10-25

#### DF-003 Current live Hermes and OMP sessions shown; stale ones flagged

**partial** · P0 · recurring · journey `J-chat-list-all-harnesses` · claimed partial

**Acceptance.** The session list shows the Hermes and OMP sessions actually running (real identity, opens the right conversation) and marks ended/closed ones as stale, without synthetic rows.

Code: `app/src/lib/live-sessions.ts:31`, `bridge/src/roster.ts:202`, `bridge/src/hermes-sessions.ts:45`

Note: Detection works for Hermes and running OMP; the same reconcile step wrongly marks running bridge-owned chats stale (see the bridge-owned entry).
Sources: H-014, C-010, dash#20, dash#28

#### DF-004 Bridge-owned running chat must not show ended

**MISSING** · P0 · recurring · journey `J-send-receive-omp` · claimed missing

**Acceptance.** A bridge-owned conversation with an active streaming or pending turn is not marked stale/ended when the roster lacks its row; Send and Queue stay enabled.

Code: none
Gap located at: `app/src/lib/live-sessions.ts:35`

Note: Confirmed in code: mergeLiveConversations marks any unmatched session stale with no check for a streaming/pending turn.
Sources: dash#143, DASH-E2E-001

#### DF-005 Continue the exact desktop session from the phone

implemented · P0 · recurring · journey `J-send-receive-hermes` · claimed unknown

**Acceptance.** The phone is another UI on the same backend/profile: sending into an already-running desktop Hermes or OMP session continues that session id; no replacement thread.

Code: `bridge/index.ts:254`, `bridge/src/hermes-continue.ts:1`, `app/src/store/app.ts:261`
Sources: H-043, dash#20, dash#81

#### DF-006 /live slash scope in search

implemented · P2 · journey `J-chat-search-fast` · claimed partial

**Acceptance.** /live and partial /li list running catalog sessions on the paired host; choosing a row opens it; unknown scopes fail closed.

Code: `app/src/lib/global-search.ts:62`
Sources: dash#28

#### DF-007 Mesh auto-discovery of tailnet bridge hosts

**MISSING** · P1 · journey `J-mesh-discovery` · claimed missing

**Acceptance.** Roster discovers other tailnet hosts running the Dash bridge and lists their sessions, not only the paired laptop.

Code: none
Gap located at: `bridge/src/roster.ts:36`, `bridge/src/roster.ts:424`

Note: Tailnet peers are listed as hosts, but remoteAgents has a type and a reader and no writer.
Sources: dash#5

#### DF-008 Roster is live and honest

implemented · P1 · journey `J-bots-tree` · claimed partial

**Acceptance.** Bots/roster shows only real running agents; empty hosts stay empty; nothing is faked; /roster does not crash when hermes is off PATH.

Code: `bridge/src/roster.ts:667`, `app/src/lib/roster.ts:49`
Sources: dash#8, dash#51

#### DF-009 Harness catalog adapters including pi and fx

**partial** · P1 · journey `J-chat-list-all-harnesses` · claimed implemented

**Acceptance.** hello.harnesses lists spawnable catalog executors (hermes, omp, grok, codex, claude, pi, fx); missing binaries show unavailable; live pi/fx sessions are adopted like others.

Code: `bridge/src/harnesses.ts:351`, `bridge/src/harnesses.ts:392`, `shared/catalog.ts:2`

Note: Adapters for pi and fx exist, but CATALOG_HARNESS_IDS omits them, so live pi/fx sessions are never adopted.
Sources: dash#17

#### DF-010 Parallel tabs, usage hub, routing and runs (Empryo-inspired)

**MISSING** · P2 · journey `J-chat-list-all-harnesses` · claimed missing

**Acceptance.** Tabs as branches of one session with Fork, live-miniature grid, usage hub with 5h/weekly bars and per-turn receipts, routing screen, read-only Runs/Schedules, Switch computer, Live jump pill, effort ladder.

Code: none

Note: Issue roadmap; not an owner chat ask.
Sources: dash#106

### Delivery and reliability

#### DF-011 Messages send reliably and delivery state is true

**partial** · P0 · recurring · journey `J-send-failure-retry` · claimed regressed

**Acceptance.** A Dash send reaches the host session exactly once; the UI distinguishes local, sent, acked-by-bridge, started and failed; a local bubble or queued ack is never shown as agent consumption.

Code: `app/src/store/app.ts:562`, `app/src/store/app.ts:572`, `app/src/store/app.ts:649`, `app/src/net/bridge.ts:331`

Note: Lost turns are marked interrupted and unsent turns are parked and flushed on reconnect. There is no client id/turn fingerprint dedupe, no ack state, and no Not sent - Retry control.
Sources: C-001, C-002, C-003, H-153, dash#50, dash#122-#131, recurring-complaints-hermes#3

#### DF-012 Failed sends are recoverable with Retry

**MISSING** · P0 · recurring · journey `J-send-failure-retry` · claimed missing

**Acceptance.** After 10 s without bridge ack or a socket drop the message shows Not sent - Retry; retry reuses the same client id and the bridge dedupes, so it never executes twice.

Code: none
Gap located at: `app/src/components/MessageRow.tsx:110`
Sources: H-153, dash#50

#### DF-013 OMP messaging works like Hermes

**partial** · P0 · recurring · journey `J-send-receive-omp` · claimed regressed

**Acceptance.** Equivalent sends through OMP and Hermes both get correct responses; fixing OMP does not regress Hermes.

Code: `bridge/src/harnesses.ts:130`, `bridge/src/roster.ts:332`

Note: OMP adapter and transcript reader exist; the stale-marking bug (live-sessions.ts:35) disables Send on running bridge-owned OMP turns.
Sources: H-146, DASH-E2E-001

#### DF-014 Stuck turns diagnosable and unstickable without killing the process

**partial** · P0 · recurring · journey `J-steer-queue-merge` · claimed partial

**Acceptance.** A blocked turn can be attributed (harness vs bridge) and recovered while the process and session continue; starting a worker does not block follow-up input.

Code: `bridge/src/hermes-steer.ts:21`, `bridge/src/turn-phase.ts:1`, `bridge/src/hermes-phase.ts:45`

Note: Steer through the gateway and phase polling exist; no unstick/cancel for a host turn Dash only observes (window-stop-external).
Sources: C-004, C-005, C-006

#### DF-015 Bridge reconnect, replay and graceful harness failure

implemented · P1 · journey `J-reconnect-reboot` · claimed implemented

**Acceptance.** Socket drops reattach and replay missed events or mark them; hung or malformed harness turns surface a structured error while the bridge stays up.

Code: `app/src/net/bridge.ts:27`, `app/src/net/bridge.ts:97`, `bridge/index.ts:97`
Sources: dash#3, dash#4

#### DF-016 PC reachable from Dash across reboots; phone stays connected

**MISSING** · P0 · journey `J-reconnect-reboot` · claimed partial

**Acceptance.** After a real PC reboot the Dash services start automatically and the phone connects authenticated; the app keeps receiving updates while the owner is away.

Code: none

Note: No service unit or autostart in this repo; reconnect logic exists only on the phone side.
Sources: C-028, H-138

#### DF-017 Response and message latency short enough for live tests

**partial** · P1 · journey `J-send-receive-hermes` · claimed unknown

**Acceptance.** Send-to-visible-response is measured during live tests and guidance arrives inside the active test window.

Code: `app/src/net/bridge.ts:331`

Note: Streaming exists; no latency measurement or budget.
Sources: H-152

#### DF-018 Provider fallback keeps Dash chats working

**partial** · P2 · journey `J-send-receive-hermes` · claimed implemented

**Acceptance.** When a provider is exhausted, Hermes sessions reached through Dash fall back to configured providers and the reply lands in the same Dash chat.

Code: `bridge/src/model-roles.ts:39`

Note: Fallback is Hermes config; Dash only reads role fallbacks.
Sources: hermes-telegram 2026-10-22T02:33

#### DF-019 Dev-server 500 and crash recovery

**partial** · P1 · journey `J-dogfood-loop` · claimed implemented

**Acceptance.** The recurring dev-server 500 is root-caused; after a crash the test state is restored and readiness is signalled before retry.

Code: `bridge/index.ts:679`
Sources: H-066, H-151

#### DF-020 Hermes transport correctness, no duplicate fallback

implemented · P1 · journey `J-send-receive-hermes` · claimed partial

**Acceptance.** JSON-RPC errors fail visibly; auth failures and unknown outcomes never resubmit through another interface; identity is isolated per conversation.

Code: `bridge/src/z0bridge-hermes.ts:18`, `bridge/src/acp/client.ts:150`
Sources: dash#9, dash#51

#### DF-021 Transport security stated and verified

**partial** · P2 · journey `J-pairing-fresh` · claimed unknown

**Acceptance.** The actual encryption and authentication path is documented and demonstrated for chat and attachments; Tailscale is not assumed to give every property.

Code: `bridge/src/bridge-security.ts:1`, `SECURITY.md:1`
Sources: H-022

### Composer

#### DF-022 One Send/Steer/Queue/Stop button at the text's leading edge

**partial** · P1 · journey `J-composer-single-button` · claimed implemented

**Acceptance.** One primary button sits at the left next to the text regardless of handedness: Send/Steer/Queue with a draft, Stop while a turn runs with an empty draft; Stop cancels host activity Dash only observes.

Code: `app/src/components/Composer.tsx:216`, `app/src/components/Composer.tsx:218`, `app/src/store/app.ts:543`

Note: Single leading button implemented; Stop only cancels Dash-owned pending/streaming turns.
Sources: H-141, R-8977, findings window-stop-external

#### DF-023 Steer an active run and merge queued messages

implemented · P1 · journey `J-steer-queue-merge` · claimed implemented

**Acceptance.** Steer reaches the running turn; queued messages can be edited, reordered, merged into one ordered message and delivered.

Code: `app/src/lib/composer-mode.ts:4`, `app/src/components/QueuedStack.tsx:14`, `app/src/lib/pending-queue.ts:20`, `app/src/store/app.ts:638`, `bridge/src/hermes-steer.ts:21`

Note: Steer is Hermes gateway-hosted only.
Sources: H-070, H-073, dash#81

#### DF-024 Drafts persist across restarts and crashes

implemented · P0 · recurring · journey `J-composer-draft-restore` · claimed regressed

**Acceptance.** An unsent draft is restored exactly after app restart, crash or agent-triggered reload.

Code: `app/src/store/composer-drafts.ts:18`, `app/src/store/composer-drafts.ts:9`

Note: Text persists (250 ms flush, 14-day expiry); unsent attachment chips do not survive the process.
Sources: H-143, dash#149

#### DF-025 Paste an image into the composer auto-attaches

**MISSING** · P1 · journey `J-composer-paste-image` · claimed partial

**Acceptance.** Pasting clipboard image data (and Gboard rich content) into the input creates one attachment chip delivered with the next send.

Code: none

Note: No onPaste/commitContent handler; expo-clipboard is used only for copy.
Sources: H-147, R-8975, dash#50

#### DF-026 Multiline wrapping composer up to about six lines

implemented · P2 · journey `J-composer-single-button` · claimed missing

**Acceptance.** Composer text wraps multiline up to about 6 lines and never scrolls sideways.

Code: `app/src/components/Composer.tsx:214`, `app/src/components/Composer.tsx:259`
Sources: R-8974

#### DF-027 Slash and @ suggestions work on Main and inside a chat

**partial** · P0 · recurring · journey `J-composer-suggestions` · claimed partial

**Acceptance.** Typing / or @ on both surfaces loads real commands/files/agents (under identity pairing too) and inserts or runs the selection; never stuck on Loading from bridge.

Code: `app/src/components/ComposerSuggestions.tsx:26`, `app/src/components/ComposerSuggestions.tsx:31`, `bridge/src/suggestions-http.ts:35`

Note: Client and server require the legacy token; identity-only pairing gets nothing.
Sources: H-050, 2026-10-25 S22 note, findings identity-http

#### DF-028 File attachments work and are Dash-themed

implemented · P1 · journey `J-composer-attach` · claimed implemented

**Acceptance.** Images and files attach through the phone transport, are saved on the host, reach the agent, and the chooser uses Dash styling.

Code: `app/src/components/AttachmentChooser.tsx:14`, `app/src/lib/attachments.ts:67`, `bridge/src/files-http.ts:59`, `shared/protocol.ts:88`

Note: 8 files/turn, 25 MiB/file; error chips have no retry.
Sources: H-021, H-117, owner-turns attachments

#### DF-029 Blurred composer background

implemented · P2 · journey `J-design-conformance` · claimed unknown

**Acceptance.** Scrolling text never shows through the composer; the input stays readable on a blurred/occluded surface.

Code: `app/src/screens/ChatScreen.tsx:447`, `app/src/components/GlassSurface.tsx:1`
Sources: H-051

#### DF-030 Harness/model/approvals popup and token speed in the input

**partial** · P1 · journey `J-model-roles` · claimed missing

**Acceptance.** From the composer the owner changes harness, quick-switches or searches models, sees pending approvals and measured tokens/s.

Code: `app/src/screens/ChatScreen.tsx:329`, `app/src/screens/ChatScreen.tsx:330`, `app/src/components/HarnessPicker.tsx:1`

Note: Harness change and approvals count exist in Options; no model switch and no tokens/s.
Sources: H-098, H-120

#### DF-031 Interactive actions within thumb reach

implemented · P2 · journey `J-chat-window-open-close` · claimed unknown

**Acceptance.** Routine actions sit near the bottom; show/hide options live in the bottom consolidated menu, not at the top.

Code: `app/src/components/ChatWindow.tsx:149`, `app/src/components/ComposerActionMenu.tsx:47`
Sources: H-055, H-127

#### DF-032 Hold-slide options menu with nested force-press options

**partial** · P2 · journey `J-settings-density` · claimed missing

**Acceptance.** Hold the chat-settings control, slide to a row, dwell and release; force/long-press a row opens that row's own options (models, profiles, pen tools); tap still runs the row.

Code: `app/src/components/ComposerActionMenu.tsx:47`, `app/src/components/ComposerActionMenu.tsx:60`, `app/src/lib/filter-gesture.ts:6`, `app/src/screens/ChatScreen.tsx:325`

Note: Hold-slide-dwell menu and stylus-pressure arming exist; only the detail row has an inspect action, no nested popup per row.
Sources: H-078, H-145, dash#120

#### DF-033 Composer micro-interactions from OMP/Tern

**partial** · P2 · journey `J-design-conformance` · claimed partial

**Acceptance.** Input-attached working and typing micro-interactions copied from OMP/Tern, restyled to Dash tokens.

Code: `app/src/components/ShimmerText.tsx:12`, `app/src/components/KeyboardDock.tsx:1`
Sources: H-096

#### DF-034 Always-attached global composer and compact popup outside chats

**partial** · P1 · journey `J-chat-window-open-close` · claimed partial

**Acceptance.** The main input stays bound to the selected session after leaving the chat; outside a chat a compact popup shows one or two messages and status.

Code: `app/src/screens/MainScreen.tsx:359`, `app/src/lib/feedback-submit.ts:10`

Note: Main Send goes to feedback chat or prefills a harness chat; no bound-session popup.
Sources: H-108, H-109

### Chat window and transcript

#### DF-035 Opening a chat shows its real transcript; panes never empty

implemented · P0 · recurring · journey `J-chat-open-history` · claimed regressed

**Acceptance.** Opening a live row hydrates the real history and attaches to in-flight turns; the middle and right panes are never empty after updates or reconnect.

Code: `app/src/lib/live-sessions.ts:53`, `app/src/lib/live-sessions.ts:58`, `app/src/store/app.ts:193`, `bridge/src/roster.ts:360`

Note: Code hydrates on open; history is requested only when the row has a session id and is not stale. Regression risk is runtime, so the journey must prove it.
Sources: H-036, dash#26, recurring-complaints-hermes#9

#### DF-036 Select text and reply to it

**MISSING** · P1 · journey `J-text-select-reply` · claimed missing

**Acceptance.** Selecting a message range (or circling it with the S Pen) and choosing reply carries that exact quote into the reply.

Code: none
Gap located at: `app/src/components/Markdown.tsx:29`

Note: Text is selectable for copy; there is no reply-to-selection action.
Sources: H-149, dash#119

#### DF-037 Chat opens as a full-screen window with cutout pill, attached dock and handed X

implemented · P0 · recurring · journey `J-chat-window-open-close` · claimed partial

**Acceptance.** A chat opens as a full-screen window over the retained workspace; the top nav becomes a slim pill around the S25 camera cutout; the composer grows into an attached dock with the badge; a small X (>=44 pt hit) in the handed bottom corner closes it and restores list position, draft, queue and voice; Back dismisses menus first.

Code: `app/App.tsx:172`, `app/src/components/ChatWindow.tsx:71`, `app/src/components/ChatWindow.tsx:149`, `app/src/lib/display-cutout.native.ts:1`, `app/src/lib/chat-window.ts:1`
Sources: H-131, H-132, H-133, H-134, R-8971

#### DF-038 Identity badge with trace tree and target switching

**partial** · P1 · journey `J-chat-identity-badge` · claimed partial

**Acceptance.** A compact host/harness/profile/session/model badge opens a tree of how it traces back; model, session or host can be switched and the switch is verified against the backend.

Code: `app/src/components/ChatWindow.tsx:120`, `app/src/components/ChatWindow.tsx:171`, `app/src/screens/ChatScreen.tsx:303`

Note: Badge and tree implemented; exact-session model change explicitly unavailable.
Sources: H-129, R-8971

#### DF-039 Context window inspection works

**partial** · P0 · recurring · journey `J-context-card` · claimed regressed

**Acceptance.** The context gauge opens real usage and compaction (or a truthful unavailable state) under every pairing method; the web gauge exposes aria-expanded.

Code: `app/src/components/ContextCard.tsx:39`, `app/src/components/ContextCard.tsx:84`, `bridge/src/context-http.ts:73`, `bridge/src/context-http.ts:87`

Note: Client sends settings.token (empty under identity pairing, 401); gauge sets no expanded state; served bridge returns 501 for compact.
Sources: H-115, H-075, dash#187, DASH-E2E-002, findings identity-http, findings compact-release-skew

#### DF-040 Prompt quick-scroll rail with previews and jump to latest

implemented · P0 · recurring · journey `J-prompt-rail` · claimed partial

**Acceptance.** Niagara-style rail scrubs prompts, previews prompt and result summary, jumps to the live bottom, and fits the keyboard-visible viewport above the composer.

Code: `app/src/components/PromptRail.tsx:42`, `app/src/lib/rail-turns.ts:46`, `app/src/lib/prompt-navigation.ts:1`
Sources: H-038, H-063, H-116, owner-turns 2026-10-21T02:35

#### DF-041 Rail tick spacing proportional to turn duration

**MISSING** · P2 · journey `J-prompt-rail` · claimed partial

**Acceptance.** Spacing between ticks is proportional to turn duration (prompt to reply settle, or now when live) with a minimum gap and equal-spacing fallback; hit-testing uses the same positions; an end timestamp is recorded on settle.

Code: none
Gap located at: `app/src/components/PromptRail.tsx:40`

Note: Positions are index/count (equal spacing); tick width encodes characters, not duration.
Sources: H-062, R-8976, dash#187

#### DF-042 Markdown, syntax highlighting and descriptive tool rows

implemented · P0 · recurring · journey `J-markdown-code` · claimed partial

**Acceptance.** Replies render markdown with syntax-highlighted code and visual variance; tool rows state purpose, arguments and result instead of generic Thinking/Running; reuse OSS libraries.

Code: `app/src/components/Markdown.tsx:29`, `app/src/components/CodeBlock.tsx:4`, `shared/tool-format.ts:42`
Sources: H-039, H-040, H-067

#### DF-043 Thinking/tool blocks optional, tree-shaped and summarised by a fast model

implemented · P1 · journey `J-thinking-tools-details` · claimed partial

**Acceptance.** Thinking and tools are hidden/compact/full per chat, expand as a file-tree hierarchy with an inspector, and a smol model summarises them without blocking streaming.

Code: `app/src/components/ReplyBlocks.tsx:37`, `app/src/components/ToolInspector.tsx:10`, `app/src/components/ThinkingSummaryChip.tsx:1`, `bridge/src/thinking-summary.ts:1`

Note: ToolInspector /files call uses the legacy token (identity-http).
Sources: H-057, H-058, H-059, R-8969

#### DF-044 Chat information density: diagrams visible, little forced expansion, useful previews

**partial** · P0 · recurring · journey `J-thinking-tools-details` · claimed missing

**Acceptance.** Each fact shows once; diagrams stay visible; important status needs no repeated expansion; chat-list previews show a summary or repos rather than a truncated last line; rarely used switches sit behind Options.

Code: `app/src/lib/live-sessions.ts:14`, `app/src/screens/ChatScreen.tsx:316`, `app/src/lib/chat-row.ts:1`

Note: Options holds detail controls; the chat-list preview is still the last line or status.
Sources: H-026, H-049, H-123, R-8966, recurring-complaints-hermes#8

#### DF-045 History shows user text, not steer/queue wrapper

**MISSING** · P1 · journey `J-steer-queue-merge` · claimed missing

**Acceptance.** After reload or rehydrate, steered/queued messages display the user's text with any wire envelope stripped for display.

Code: none
Gap located at: `app/src/lib/live-sessions.ts:66`

Note: historyToMessages copies host text unchanged.
Sources: dash#121

### Indicators and identity

#### DF-046 Compact live popup and subagent tree inside the chat

**partial** · P0 · recurring · journey `J-subagent-indicator` · claimed regressed

**Acceptance.** A compressed, expandable tree of active subagents/jobs appears in the current chat (shared Tree style) and does not disappear.

Code: `app/src/screens/ChatScreen.tsx:335`, `app/src/components/WorkersStrip.tsx:61`, `bridge/src/hermes-workers.ts:80`

Note: WorkersStrip is mounted in the dock but fed only by Hermes /hermes/workers; other harnesses show nothing.
Sources: H-090, H-095, H-156, recurring-complaints-hermes#7

#### DF-047 One main working indicator; no duplicate rows

implemented · P1 · journey `J-subagent-indicator` · claimed implemented

**Acceptance.** During main and child work exactly one primary live indicator shows; child activity is subtle; never a second working/Queued row.

Code: `app/src/lib/thinking.ts:26`, `app/src/components/MessageRow.tsx:55`
Sources: H-091, R-8966

#### DF-048 Thinking orbs wired into chat and voice states

implemented · P0 · recurring · journey `J-voice-live-call` · claimed partial

**Acceptance.** The thinking-orbs library shows idle/thinking/working/voice states in chats and a large orb in mic/live mode.

Code: `app/src/components/AgentOrb.tsx:1`, `app/src/components/EffortOrbs.tsx:48`, `app/src/components/OrbMotion.tsx:12`, `app/src/screens/VoiceScreen.tsx:47`
Sources: H-027, H-084, dash#27

#### DF-049 Shimmer status text lights the glyphs

**partial** · P2 · journey `J-perf-profile` · claimed implemented

**Acceptance.** Live status text brightens the letters with a band sweeping through them (gradient shader), never an overlay box; the loop stops when unfocused or backgrounded.

Code: `app/src/components/ShimmerText.tsx:12`, `app/src/components/ShimmerText.tsx:30`

Note: Glyph shader implemented; no focus/AppState gate or cleanup (shimmer-loop).
Sources: H-094, R-8967, findings shimmer-loop

#### DF-050 Hermes profile faces from the real Moodie source

implemented · P0 · recurring · journey `J-bots-tree` · claimed unknown

**Acceptance.** Profile bots use synergy.ai Moodie geometry and motion with MIT attribution; identity colour is stable per profile; state changes expression only.

Code: `app/src/components/BotFace.tsx:13`, `app/src/lib/moodie-identity.ts:24`
Sources: H-097, R-8970

#### DF-051 AODL visual encodings for avatars and cores

implemented · P2 · journey `J-orchestra-views` · claimed partial

**Acceptance.** Avatars, Orchestra cards, live rows and search hits render AODL visual.json encodings; unknown ids fail closed.

Code: `app/src/catalog/visual.ts:9`, `app/src/components/HarnessAvatar.tsx:7`, `app/src/components/TopologyBadge.tsx:1`
Sources: dash#21

### Generated UI and Ripple

#### DF-052 Generated UI renders as working native UI with a loader

**partial** · P0 · recurring · journey `J-genui-render` · claimed regressed

**Acceptance.** genui, openui-lang and generated prototypes render as interactive native UI behind a bounded loader, never as a raw code flash; controls perform real actions or say unavailable.

Code: `app/src/components/genui/GenerativeBlock.tsx:18`, `app/src/components/genui/GenerativeBlock.tsx:25`, `app/src/lib/openui-roadmap.ts:4`, `app/src/components/genui/GenUI.tsx:14`, `app/src/lib/generation-state.ts:1`

Note: openui-lang only renders the fixed Roadmap component; other OpenUI components are not supported.
Sources: H-030, H-046, H-113, H-119, dash#114

#### DF-053 Inline xyflow diagrams, images and components for Hermes and OMP

implemented · P1 · journey `J-genui-render` · claimed partial

**Acceptance.** Mermaid-style diagrams render as interactive xyflow; images and generated components render inline in both harness chats.

Code: `app/src/components/genui/DiagramDOM.tsx:5`, `app/src/lib/mermaid.ts:6`, `app/src/components/genui/InlineImage.tsx:27`
Sources: H-054

#### DF-054 Ripple ephemeral UI and fx0 live surface in Dash and web

implemented · P0 · recurring · journey `J-live-surface` · claimed partial

**Acceptance.** Ripple ephemeral components render in Dash and web; fx0 is a fast sandboxed live-canvas worker while Hermes keeps the conversation.

Code: `app/src/components/LiveSurface.tsx:19`, `app/src/components/LiveArtifactFrame.tsx:17`, `app/src/components/LiveArtifactFrame.web.tsx:14`, `bridge/src/live-surface.ts:1`
Sources: H-034, H-112, owner-turns 2026-10-20T19:45

#### DF-055 Inline Ripple roadmap with per-feature progress

**partial** · P0 · recurring · journey `J-roadmap-inline` · claimed missing

**Acceptance.** Asking for the Dash roadmap renders an inline Ripple roadmap with progress bars per feature, backed by receipts.

Code: `app/src/components/genui/RippleRoadmap.tsx:1`, `app/src/catalog/roadmap.json:1`

Note: Roadmap data is a bundled JSON, not generated from the live ledger.
Sources: H-110, dash#114

### Study mode

#### DF-056 Study/brainstorming mode for fast ephemeral UI

**partial** · P2 · journey `J-study-mode` · claimed partial

**Acceptance.** A study mode in Dash and Ripple (phone and web) turns a prompt into an ephemeral UI (native genui JSON tier and sandboxed HTML/fx0 tier), iterates with the LLM, reuses Anatomy ('wheresryan22'), and never edits app source.

Code: `app/src/components/LiveSurface.tsx:19`

Note: Two render tiers exist through Live surface; no study mode entry, no Anatomy library.
Sources: C-020, C-021, C-022, C-023, C-024, C-025, C-026, C-027

### Voice (z0live)

#### DF-057 Live voice call works inside Dash

**partial** · P0 · recurring · journey `J-voice-live-call` · claimed regressed

**Acceptance.** Tapping Live starts an in-app duplex call bound to the attached chat: no error, no Lawnchair/z0live popup, every utterance delivered, barge-in, mute/end, natural pacing without filler, usable away from the PC with a fast Luna liaison.

Code: `app/src/components/ContinuousVoiceRoot.tsx:45`, `app/src/components/ContinuousVoiceRoot.tsx:53`, `app/src/lib/continuous-voice.ts:10`, `app/src/lib/continuous-voice.ts:138`, `bridge/src/voice-bootstrap.ts:17`

Note: Native in-app call exists, but normal Hermes roster ids (hermes:session:...) fail the bootstrap profile regex with 400.
Sources: H-099, H-107, H-111, H-144, H-005, H-016, C-014, C-015, recurring-complaints-hermes#2, findings voice-profile-id

#### DF-058 In-app dictation that stays inside Dash

implemented · P0 · recurring · journey `J-voice-dictation` · claimed regressed

**Acceptance.** Dictation records and inserts editable text at the cursor without the keyboard open and without the system recognizer popup; errors stay in Dash.

Code: `app/src/lib/recorded-speech.ts:3`, `app/src/lib/useRecordedSpeech.ts:9`, `app/src/components/Composer.tsx:104`, `bridge/src/files-http.ts:44`

Note: Requires bridge speech deployment (/transcribe 503 otherwise). RECOGNIZE_SPEECH constant is exported but unused.
Sources: H-092, H-099, R-8985, owner-turns 2026-10-22

#### DF-059 Telegram-style mic pill for Dictate vs Live

**partial** · P1 · journey `J-voice-mic-pill` · claimed partial

**Acceptance.** Holding the mic grows a pill with the other mode; sliding picks; release only switches the mode; tap uses it; settings help matches.

Code: `app/src/components/MicButton.tsx:24`, `app/src/lib/mic-gesture.ts:51`, `app/src/screens/SettingsScreen.tsx:158`

Note: Gesture implemented; Settings help text still describes long-press as a handedness switch.
Sources: H-100, R-8983, findings help-mic

#### DF-060 z0live as one long-lived shared voice service wired to Hermes

**partial** · P1 · journey `J-z0live-service` · claimed partial

**Acceptance.** One z0live service serves Dash, Lawnchair and assistant; knows work history; launches tasks via Hermes/z0intelligence; uses a high-quality realtime voice; liaison + meta-agent + worker split.

Code: `app/src/lib/z0live-state.ts:26`, `bridge/src/z0live-state.ts:36`, `app/src/lib/continuous-voice.ts:61`

Note: Dash calls the external z0live broker; the service itself lives outside this repo.
Sources: H-001, H-002, H-004, H-006, H-018, C-016

#### DF-061 z0live screen understanding and in-app control

**MISSING** · P0 · recurring · journey `J-z0live-service` · claimed missing

**Acceptance.** z0live can see the screen (privacy-preserving local model or host inference) and click buttons/type text through accessibility as fast as phone-harness.

Code: none

Note: External to the Dash repo.
Sources: H-003, H-015, owner-turns 2026-10-21T00:53

#### DF-062 Gesture activation: Oura double-tap, call gestures, STT split

**MISSING** · P2 · journey `J-z0live-service` · claimed partial

**Acceptance.** Oura double-tap activates voice on the device in use; double tap starts/mutes, triple tap ends; separate gestures for z0live and keyboard STT.

Code: none

Note: External to the Dash repo.
Sources: H-010, H-044, H-045

#### DF-063 z0live conversation-quality experiments

**MISSING** · P2 · journey `J-z0live-service` · claimed unknown

**Acceptance.** Candidate pipelines (SLM+TTS+STT, Moshi) are measured on one spoken task for latency and quality; latency tiers (local SLM, host, cloud) explored.

Code: none

Note: Research task; external.
Sources: C-016, owner-turns 2026-10-21T00:53

### Annotation, S Pen and artifacts

#### DF-064 Artifact viewer: tldraw canvas, draw-and-speak review, linked 3D views

**partial** · P2 · journey `J-live-surface` · claimed unknown

**Acceptance.** Review artifacts support drawing while speaking, old/new choice with speech-to-object association, tldraw for the expanded canvas, linked rotatable 3D views, and personal mode shortcuts.

Code: `app/src/screens/ArtifactStageScreen.tsx:21`, `app/src/components/artifact-stage/ArtifactStage.tsx:11`

Note: Stage hosts an external review app in a WebView; no tldraw, 3D or speech-to-object code in Dash.
Sources: H-019, H-031, H-032, H-033

#### DF-065 S Pen annotation with visible ink, fast entry and working mic

**partial** · P0 · recurring · journey `J-annotation-spen` · claimed regressed

**Acceptance.** Annotation mode opens without lag, freezes scrolling, shows ink, keeps the composer usable, lets the owner talk, and delivers screenshot+ink+speech to the same chat; a discoverable UI trail exists before it is called ready.

Code: `app/src/components/annotate/AnnotationRoot.tsx:102`, `app/src/components/annotate/AnnotationRoot.tsx:175`, `app/src/components/annotate/AnnotationRoot.tsx:216`, `app/src/store/annotate.ts:60`, `app/src/lib/voice-annotation.ts:11`

Note: Full overlay, tools, hold-talk and submit exist; entry lag and ink visibility are runtime claims that only the device journey can settle.
Sources: H-083, H-126, H-135, H-142, recurring-complaints-hermes#1, dash#119, dash#142

#### DF-066 S Pen button toggles annotation and normal mode

**MISSING** · P0 · recurring · journey `J-annotation-spen` · claimed missing

**Acceptance.** Pressing the S Pen side button toggles between annotation and normal interaction.

Code: none
Gap located at: `app/src/lib/annotate/pointer.ts:5`

Note: Stylus contact enters annotation when pen mode is on; no side-button detection module.
Sources: H-150, dash#119

#### DF-067 S Pen hover indication and micro-interactions

**MISSING** · P2 · journey `J-annotation-spen` · claimed missing

**Acceptance.** Hovering the S Pen over controls and messages shows its position and a restrained contextual highlight.

Code: none
Sources: H-130

#### DF-068 Agent draws pointers and navigates the app in the same chat

**partial** · P1 · journey `J-annotation-agent-pointer` · claimed partial

**Acceptance.** In the current conversation the agent highlights a target and flies to the relevant screen through an in-app API.

Code: `app/src/debug/nav.ts:1`, `app/src/lib/app-route-link.ts:1`

Note: Deep links and a debug navigation controller exist; no agent-drawn pointer.
Sources: H-125

### Turbo and live preview

#### DF-069 Turbo mode: talk, mark up with S Pen, fix immediately, see it on the phone

**partial** · P0 · recurring · journey `J-dogfood-loop` · claimed partial

**Acceptance.** End to end: the owner talks live, marks up the screen, the agent fixes it right away and the change hot-reloads on the phone preview; the pipeline is continuously sped up. This is Dash's top feature.

Code: `app/src/turbo.ts:1`, `app/src/components/annotate/AnnotationRoot.tsx:175`, `app/src/components/ContinuousVoiceRoot.tsx:45`

Note: App side has a TURBO motion flag, annotation and voice; the fix/merge/hot-reload loop is outside the repo.
Sources: owner-turns hermes-local 2026-10-25, zer0models 2026-10-23T04:07, H-083

#### DF-070 Turbo via Luna + uiautomator2: parallel ChatGPT chats on the S22

**MISSING** · P0 · recurring · journey `J-turbo-chatgpt-fanout` · claimed partial

**Acceptance.** Opt-in fanout opens the requested number of ChatGPT Android chats on the S22 (latest ask: 25), one per issue/worktree, only the intended ones; the orchestrator runs merge queue and verification and reports real counts.

Code: none

Note: Lives in orchestration tooling outside this repo.
Sources: H-087, H-155, H-009, C-012, C-013

#### DF-071 Tell the owner what to test and take him to that screen

**MISSING** · P0 · recurring · journey `J-turbo-preview-brief` · claimed partial

**Acceptance.** When a worktree merges into the preview, Dash shows a compact AODL test brief (original ask, expected behaviour) and navigates to the feature; blocked/installed/test-ready are distinct and he is notified.

Code: none
Gap located at: `app/src/lib/app-route-link.ts:1`, `app/src/lib/notification-routing.ts:1`

Note: Route links exist; no preview test-brief surface.
Sources: H-088, C-011

#### DF-072 Requested changes reach the phone via Metro fast refresh and a preview branch

**partial** · P0 · recurring · journey `J-turbo-preview-brief` · claimed regressed

**Acceptance.** Features ship to a preview branch with GitOps rollback; the served tip equals the merged worktree; JS changes hot-reload on the phone; the installed build stays current; the preview is never broken.

Code: `bridge/index.ts:679`, `scripts/rollout.py:1`, `scripts/ensure-rollout-branches.sh:1`, `.github/workflows/promote-preview.yml:1`

Note: Rollout branches and promote workflows exist; served tip vs merged tip is not enforced.
Sources: H-082, H-101, H-106, recurring-complaints-hermes#4

#### DF-073 Dogfood self-test mode

**partial** · P0 · recurring · journey `J-dogfood-loop` · claimed partial

**Acceptance.** A toggle runs Dash from the preview Metro with a DOGFOOD pill; a gesture captures screen, route, logs and note as an issue that becomes a Turbo task; Fixed?/still-off confirmation; Turbo uses faster motion.

Code: `app/src/turbo.ts:5`, `app/src/components/Tree.tsx:28`

Note: Only the faster-motion TURBO flag exists.
Sources: H-085, H-086, dash#107

#### DF-074 Five-effort ChatGPT benchmark feeding Turbo

**MISSING** · P2 · journey `J-turbo-chatgpt-fanout` · claimed partial

**Acceptance.** One Dash task runs in five chats at distinct effort levels; durations and judged quality pick Turbo worker settings.

Code: none
Sources: C-012, C-013

### Process, verification and Bend laws

#### DF-075 Bugs blocking live Dash use are priority one

**MISSING** · P0 · recurring · journey `J-process-audit` · claimed unknown

**Acceptance.** A send/voice/navigation blocker found while dogfooding preempts feature work until it is usable or explicitly blocked.

Code: none

Note: Process rule; enforced by Bend laws, not app code.
Sources: H-102, owner-turns hermes-local 2026-10-21T00:53

#### DF-076 Watch agent auto-attaches while Dash is used

**MISSING** · P0 · recurring · journey `J-watch-agent` · claimed partial

**Acceptance.** Lightweight Luna watchers start automatically when the owner uses Dash and report errors visible in logs before he does.

Code: none
Sources: H-124, owner-turns 2026-10-25T21:01

#### DF-077 Real tests before done; Bend laws keep work going; E2E on a virtual monitor

**partial** · P0 · recurring · journey `J-process-audit` · claimed partial

**Acceptance.** Nothing is done without e2e tester army, real integration and S22/S25 native journeys with exact-SHA receipts; E2E runs on a virtual monitor; recurring breakage gets a root cause, a regression test and a law.

Code: `scripts/verify-dash/control-dash.ts:1`, `.maestro/nav-dots.yaml:1`

Note: Proof scripts and Maestro flows exist; no virtual-display harness and no law linking features to journeys before this spec.
Sources: H-121, H-148, H-154, owner process steps 1-3

#### DF-078 Exhaustive source-linked spec matching the real surface

implemented · P0 · recurring · journey `J-process-audit` · claimed partial

**Acceptance.** Every owner ask maps to a DF entry with code refs and a device journey; status is decided from code; the spec is iterated until it matches the app.

Code: `spec/features.yaml:1`, `spec/check.py:1`
Sources: H-157, SUMMARY-repo

#### DF-079 Separate OMP work queue coordinated with Hermes via ACP

**MISSING** · P2 · journey `J-process-audit` · claimed missing

**Acceptance.** OMP owns a visible queue of low-hanging in-app UI fixes Hermes has not started, with ACP handoff.

Code: none
Gap located at: `roadmap.yml:1`
Sources: C-007, C-008, C-009

#### DF-080 Turbo policy: no free-tier coding, no Grok, builds on a dedicated build host

**partial** · P1 · journey `J-model-roles` · claimed unknown

**Acceptance.** Free-tier models never write code; Grok is cancelled; planner is Opus; builds/tests go to a dedicated build host.

Code: `bridge/src/model-roles.ts:25`

Note: Role map still contains a grok harness in the catalog (shared/catalog.ts:2).
Sources: dash#107, H-060

#### DF-081 Phones used as workers at full capacity

**MISSING** · P2 · journey `J-turbo-chatgpt-fanout` · claimed implemented

**Acceptance.** S22+/S25 are used as offload workers within owner-granted limits (S25 floor 2%).

Code: none

Note: External infra.
Sources: owner-turns 2026-10-20T21:50, zer0models 2026-10-23T20:59

#### DF-082 Inspiration extraction into Dash issues

implemented · P2 · journey `J-process-audit` · claimed partial

**Acceptance.** Patterns from supplied reference videos/apps are recorded in a Dash issue separately from proposals.

Code: `docs/design/ai-ui-patterns/README.md:1`
Sources: H-076, dash#106

#### DF-083 Verification pyramid and mutation testing

implemented · P1 · journey `J-process-audit` · claimed implemented

**Acceptance.** Unit, TDD fail-then-pass, mutation >=80 including protocol/roster operators, control-dash runtime check and Maestro device checks.

Code: `scripts/verify-dash/control-dash.ts:1`
Sources: dash#10, dash#12, dash#65

#### DF-084 Standing test, accessibility and performance guard tracks

**MISSING** · P2 · journey `J-process-audit` · claimed missing

**Acceptance.** Per-store unit tests, per-component accessibility labels, performance guards and boundary negative controls, one PR slice each.

Code: none

Note: Agent-defined from the owner lane.
Sources: dash#50, dash#140-#186

#### DF-085 Dash-debug skill for pair/roster/attach troubleshooting

implemented · P2 · journey `J-process-audit` · claimed implemented

**Acceptance.** An in-repo skill documents debugging pair, roster and WS attach without pasting tokens.

Code: `.cursor/skills/dash-debug/SKILL.md:1`
Sources: dash#6

### Performance and motion

#### DF-086 Lazy loading and JIT UI so chat lists never lag

**partial** · P0 · recurring · journey `J-perf-profile` · claimed unknown

**Acceptance.** Chat list and transcript are virtualized; rows and heavy content (history, tool payloads, generated UI) load on demand; scrolling and navigation stay under frame budget at full chat volume.

Code: `app/src/screens/panes/ChatsPane.tsx:174`, `app/src/screens/ChatScreen.tsx:447`, `app/src/store/conversation-persistence.ts:13`, `app/src/lib/live-sessions.ts:53`

Note: FlashList virtualizes both lists and history loads per session on open; the cache keeps 64 entries of 256 KiB. No pagination of the roster or of long histories, and no measured budget.
Sources: owner task brief 2026-10-25

#### DF-087 Quick-scroll and transcript scrolling without lag

implemented · P1 · journey `J-perf-profile` · claimed partial

**Acceptance.** Scrubbing a long conversation while streaming stays responsive with no animation stalls.

Code: `app/src/components/PromptRail.tsx:45`, `app/src/lib/rail-turns.ts:29`

Note: UI-thread gesture and weak-keyed summaries; not measured.
Sources: H-061

#### DF-088 Whole app is fast: no 2 fps lag, no leak, loops gated

**partial** · P0 · recurring · journey `J-perf-profile` · claimed regressed

**Acceptance.** Representative S22/S25 journeys show no sustained UI-thread jank (120 Hz target on S25), no memory growth (the ~150 MB/min chat leak is fixed), and ambient loops stop when backgrounded or unfocused.

Code: `app/src/components/OrbMotion.tsx:39`, `app/src/screens/ChatScreen.tsx:412`, `app/src/motion-ambient.ts:1`, `app/src/store/conversation-persistence.ts:13`

Note: Orb gating and bounded cache exist; ShimmerText and ContextCard loops are ungated; no in-repo jank/PSS budget.
Sources: H-140, C-017, C-018, dash#50, dash#187, recurring-complaints-hermes#5, findings shimmer-loop

#### DF-089 Fast, quiet motion profile

**partial** · P1 · journey `J-perf-profile` · claimed implemented

**Acceptance.** Transitions are 100-120 ms ease-out on opacity/transform/colour; no entrance animations on structural change; no bounce; streaming publishes at most once per frame.

Code: `app/src/motion.ts:12`, `app/src/turbo.ts:1`, `app/src/components/Tree.tsx:45`

Note: TURBO profile matches; normal builds keep layout/entering animations in Tree.
Sources: H-071, H-089, R-8965, dash#97, dash#105

#### DF-090 Thinking-orb and component-lab animations smooth

implemented · P1 · journey `J-perf-profile` · claimed implemented

**Acceptance.** Orb state transitions and component lab scroll without stalls; profiler rows are not squished.

Code: `app/src/components/OrbMotion.tsx:12`, `app/src/screens/LabScreen.tsx:41`
Sources: H-068, H-118

#### DF-091 Event-trace expansion responsive

implemented · P2 · journey `J-perf-profile` · claimed partial

**Acceptance.** Expanding product-grouped trace sessions is responsive.

Code: `app/src/components/trace/TraceTimeline.tsx:171`
Sources: H-103

### Orchestra and trace

#### DF-092 Orchestration tree and graph views with real semantics

implemented · P0 · recurring · journey `J-orchestra-views` · claimed partial

**Acceptance.** Orchestra renders the real AODL network and live roster as tree and graph; views have meaning; node colours and legend are meaningful and interactive; glyphs are intuitive; motion is functional; multi-host views keep identity explicit.

Code: `app/src/components/IntentionalOrchestra.tsx:32`, `app/src/lib/orchestra-views.ts:3`, `app/src/lib/useOrchestraEvidence.ts:5`, `bridge/src/orchestra-http.ts:144`, `app/src/catalog/orchestra.ts:7`

Note: Spine/Constellation/Radial/Islands were replaced by Work/Lineage/Triage/Fleet over live last-24h evidence.
Sources: H-023, H-028, H-029, H-053, H-056, H-072, dash#19, dash#24

#### DF-093 Agent trace is live and shows ask, intent contract, receipts and artifacts

**partial** · P0 · recurring · journey `J-trace-live` · claimed regressed

**Acceptance.** Trace is wired to live events (not a bundled snapshot); each unit shows the owner's ask verbatim, the AODL intent contract, receipt-backed validation (unknown without receipt), and artifacts; LLM interpretation and a recommended action; no colour overload.

Code: `app/src/trace/source.ts:12`, `app/src/components/trace/TraceTimeline.tsx:171`, `app/src/components/trace/TraceDetail.tsx:55`

Note: Bundled snapshot; no trace_snapshot message in the bridge; no intent contract or artifact section.
Sources: H-041, H-047, H-048, H-104, H-105, H-122, R-8973, findings trace-not-live

#### DF-094 Zero card with nested agent trace above the composer

**MISSING** · P2 · journey `J-trace-live` · claimed partial

**Acceptance.** Agent trace is a sub-card inside the Zero card anchored above the input; it tucks away and reappears.

Code: none
Sources: H-080, H-081

#### DF-095 Row-specific long-press dropdown on trace rows

implemented · P2 · journey `J-trace-live` · claimed implemented

**Acceptance.** Holding a trace row opens a dropdown of actions for that row only.

Code: `app/src/components/trace/TraceTimeline.tsx:171`
Sources: H-093, H-069

#### DF-096 Project detail from search

implemented · P2 · journey `J-orchestra-views` · claimed partial

**Acceptance.** Selecting a product in search opens project/provider state, agents and linked chats.

Code: `app/src/screens/OrchestraDetailScreen.tsx:20`
Sources: dash#19

### Approvals

#### DF-097 Dash as HITL approval surface with bulk approve and comments

implemented · P1 · journey `J-approvals-batch` · claimed missing

**Acceptance.** Proposed upstream actions can be bulk-approved, reviewed one by one, or answered with a required manual comment; unrelated work is not blocked waiting for the Turbo approval experience.

Code: `app/src/screens/ApprovalsScreen.tsx:27`, `app/src/store/approvals.ts:1`, `bridge/index.ts:702`, `bridge/src/gate/store.ts:17`

Note: Requires DASH_GATE_ENABLED=1 on the bridge.
Sources: H-011, H-136, owner-turns 2026-10-20

#### DF-098 Swipe completion shows a clear done state

implemented · P2 · journey `J-approvals-batch` · claimed implemented

**Acceptance.** Do/Not now swipes end in an in-bounds greened-out completed state with Undo.

Code: `app/src/components/trace/ActionChip.tsx:89`, `app/src/trace/chip-state.ts:3`

Note: Local-only decision; sends no host approval.
Sources: H-074

#### DF-099 Needs OK in-chat permission approvals

**MISSING** · P1 · journey `J-approvals-batch` · claimed implemented

**Acceptance.** ACP session/request_permission is forwarded with its options; an inline Needs OK card and 'N need OK' badge appear (never a bare 'ask'); a safe visible deny happens at 60 s; background notification.

Code: none
Gap located at: `bridge/src/acp/client.ts:155`, `app/src/components/trace/TraceTimeline.tsx:514`

Note: ACP permission requests are auto-cancelled by the bridge; 'needs OK' wording exists only in the trace snapshot view.
Sources: dash#50, dash#132-#139, COMPLAINTS-MATRIX row 17

### Settings

#### DF-100 Information density separate from layout density; contextual settings

**partial** · P1 · journey `J-settings-density` · claimed partial

**Acceptance.** Detail level and spacing are separate controls in a composer-side settings control beside @, contextual per page (Orchestra views/reset included); Rich is not over-spaced.

Code: `app/src/components/Density.tsx:32`, `app/src/screens/LabScreen.tsx:41`, `app/src/screens/ChatScreen.tsx:316`

Note: Density picker exists only in the component lab; chat detail mode is per conversation; no information-density control.
Sources: H-077, H-078, H-079, H-075

#### DF-101 Left-handed mode

implemented · P1 · journey `J-settings-handedness` · claimed implemented

**Acceptance.** Handedness mirrors thumb-side controls, rails, close X and swipe direction; send stays at the text's leading edge.

Code: `app/src/screens/SettingsScreen.tsx:149`, `app/src/lib/handedness.ts:15`, `app/src/lib/useHandedness.ts:15`
Sources: H-065

#### DF-102 Model role parity and read-only model inventory

implemented · P2 · journey `J-model-roles` · claimed unknown

**Acceptance.** Roles (judge/tiny/smol/large/default/vision/planning/orchestrating) mirror OMP and update with subscription changes; health is visible.

Code: `app/src/components/ModelsPanel.tsx:8`, `bridge/src/model-roles.ts:25`, `shared/model-roles.ts:1`, `bridge/src/models-http.ts:5`
Sources: H-060

#### DF-103 Night filter at sunrise/sunset

**MISSING** · P2 · journey `J-design-conformance` · claimed missing

**Acceptance.** A night colour filter turns on at sunset and off at sunrise on a schedule.

Code: none

Note: Agent-sourced; needs owner confirmation.
Sources: agent roadmap 2026-10-22 (no owner message found)

#### DF-104 Privacy: Forget and Delete clear all local state

**partial** · P2 · journey `J-privacy-forget` · claimed unknown

**Acceptance.** Forget this bridge and Delete chat also clear drafts, mic default, notification setting, trace feedback and voice cursor.

Code: `app/src/store/app.ts:151`, `app/src/store/app.ts:282`, `app/src/store/composer-drafts.ts:18`

Note: Agent finding; owner confirmation pending.
Sources: findings forget-drafts (agent finding)

### Pairing

#### DF-105 Pair once: sound or magic link, shared z0bridge identity, agent onboarding

**partial** · P0 · recurring · journey `J-pairing-fresh` · claimed partial

**Acceptance.** Pairing succeeds on a fresh install by sound pairing or a link that fills details, or by asking the agent; Dash and z0live reuse one z0bridge identity; identity pairing works for every HTTP feature.

Code: `app/src/screens/PairScreen.tsx:115`, `app/src/screens/PairScreen.tsx:210`, `app/src/lib/pair-api.ts:87`, `app/src/lib/identity-client.ts:29`, `bridge/src/pairing-http.ts:130`

Note: All pairing methods exist; identity enrollment saves token '' so context, suggestions, tool files and supervision fail.
Sources: H-013, H-042, H-114, H-017, dash#79, recurring-complaints-hermes#11, findings identity-http

### Notifications and share

#### DF-106 Notifications and Android share target

implemented · P2 · journey `J-notifications-share` · claimed partial

**Acceptance.** Silent local notices for replies/errors/approvals deep-link to the exact chat; any file type can be shared into a chosen chat; host files can be sent to the phone.

Code: `app/src/lib/native-notifications.native.ts:39`, `app/src/components/NativeEvents.tsx:62`, `app/modules/dash-share/android/src/main/java/app/dash/share/ShareInbox.kt:13`, `app/src/lib/attachments.ts:134`

Note: No push service: notices arrive only while the app runtime is connected.
Sources: hermes-telegram 2026-10-22T02:40

### Navigation and shell

#### DF-107 Default Main tab is Orchestra with live chats linked

implemented · P2 · journey `J-orchestra-views` · claimed partial

**Acceptance.** Cold open lands on Orchestra (the self-development loop); tapping a node or chat opens a real thread, never an empty chat.

Code: `app/src/lib/home.ts:2`, `app/src/screens/MainScreen.tsx:114`

Note: SURFACE.md says Chats is default; code at HEAD sets DEFAULT_MAIN_TAB = 2 (Orchestra).
Sources: dash#29, dash#65

#### DF-108 Navigation predictable; top bar kept; Chat vs Live surface unambiguous

implemented · P0 · recurring · journey `J-chat-window-open-close` · claimed unknown

**Acceptance.** Opening or leaving a chat never relocates navigation unexpectedly; the top bar is kept until the chat-window pill applies; the selected surface (Chat vs Live) is always identified.

Code: `app/src/components/GelNav.tsx:166`, `app/src/screens/ChatScreen.tsx:319`, `app/src/screens/ChatScreen.tsx:397`
Sources: H-020, H-035, H-128

#### DF-109 Fullscreen edge-to-edge

implemented · P1 · journey `J-fullscreen-launch` · claimed missing

**Acceptance.** Dash runs fullscreen with the status bar hidden and revealed by swipe.

Code: `app/App.tsx:157`, `app/App.tsx:125`
Sources: H-139, R-8979

#### DF-110 Bots page collapsible by host with correct vocabulary

implemented · P0 · recurring · journey `J-bots-tree` · claimed implemented

**Acceptance.** Bots groups by collapsible host; harness, bot/profile, host and session are distinct terms; no repeated unrelated icons.

Code: `app/src/lib/bots-tree.ts:19`, `app/src/components/Tree.tsx:40`

Note: Collapse state is in memory only.
Sources: H-024, H-025

#### DF-111 Nav dots centred with CI guard

implemented · P2 · journey `J-design-conformance` · claimed partial

**Acceptance.** Pager dots are vertically centred in the gold nav; a Maestro/screenshot check fails CI otherwise.

Code: `scripts/assert-nav-dots.ts:1`, `.maestro/nav-dots.yaml:1`, `app/src/components/golden-nav.ts:1`
Sources: dash#7, dash#11

### Design rules

#### DF-112 Shared Tree component for hosts, subagents and turn details

**partial** · P2 · journey `J-subagent-indicator` · claimed partial

**Acceptance.** Every hierarchy reuses the shared Tree component.

Code: `app/src/components/Tree.tsx:40`, `app/src/lib/bots-tree.ts:19`

Note: WorkersStrip does not use Tree.
Sources: H-095, R-8969

#### DF-113 Preserve Dash's black/gold liquid-glass design language

implemented · P0 · recurring · journey `J-design-conformance` · claimed implemented

**Acceptance.** Changes keep the existing DESIGN.md system (OLED black, cream ink, gold accent, glass nav, 44 dp targets); no restyle or theme module; external demos may borrow it.

Code: `app/src/theme.ts:6`, `app/src/components/GlassSurface.tsx:1`, `DESIGN.md:1`, `scripts/assert-living-night.mjs:1`
Sources: H-008, H-137, C-019, dash#51

#### DF-114 Dash is the agent control plane, not infra dashboards

implemented · P0 · recurring · journey `J-design-conformance` · claimed implemented

**Acceptance.** Agent sessions, steering and LLM observability live in Dash; infrastructure views stay in Company OS.

Code: `README.md:1`
Sources: H-037

#### DF-115 Mobile-native gestures and proactive next action

**partial** · P0 · recurring · journey `J-design-conformance` · claimed partial

**Acceptance.** Approved prototypes ship with native gestures and micro-interactions; Dash surfaces the next useful action from intent, goals and roadmap so the dev stays in flow.

Code: `app/src/components/TileGestures.tsx:57`, `app/src/components/InteractiveTile.tsx:59`

Note: Gestures exist; no next-action surface.
Sources: H-052, H-064, dash#15

#### DF-116 Compact layouts that fit the S25

**partial** · P0 · recurring · journey `J-design-conformance` · claimed partial

**Acceptance.** No sparse layouts or overflow at phone widths; information fits horizontally.

Code: `app/src/lib/tile-layout.ts:1`
Sources: owner-turns 2026-10-20T16:00, 2026-10-21T08:28

#### DF-117 Presence is not controllability; no demo data as live work

**partial** · P0 · recurring · journey `J-orchestra-views` · claimed partial

**Acceptance.** Installed is not online and accepted is not completed: unknown/offline/ended states are shown honestly and no demo catalog appears as live work.

Code: `app/src/catalog/runtime-state.ts:10`, `app/src/lib/roster.ts:49`

Note: Mock data remains in app/src/mock and debug seeds; runtime states are honest where wired.
Sources: dash#51

### Architecture

#### DF-118 Bridge as thin persistent ACP supervisor with shared z0live voice

**partial** · P1 · journey `J-send-receive-hermes` · claimed partial

**Acceptance.** The bridge becomes a thin persistent host ACP supervisor; voice is z0live-launched, not a new Dash audio runtime; Tailnet-only authenticated pairing with legacy CLI opt-in.

Code: `bridge/acp-runtime.ts:10`, `bridge/src/acp/client.ts:150`, `bridge/src/voice-bootstrap.ts:8`
Sources: dash#51, dash#60, dash#65

### Other

#### DF-119 Phone-native app instead of a separate website; every page works

**partial** · P0 · recurring · journey `J-design-conformance` · claimed partial

**Acceptance.** Installed Dash covers session and voice workflows natively; existing code is cleaned up and every page works; zerOS ideas are present.

Code: `app/App.tsx:140`
Sources: H-007, H-012, owner-turns hermes-cli 2026-10-19

#### DF-120 In-app feedback surface on in beta

implemented · P2 · journey `J-dogfood-loop` · claimed partial

**Acceptance.** Voice, typed notes and long-press on rows file product feedback to the Dash secondmate; on by default with a setting.

Code: `app/src/lib/feedback-submit.ts:10`, `app/src/lib/chat-row-actions.ts:37`, `app/src/screens/MainScreen.tsx:359`
Sources: dash#29, dash#65

#### DF-121 Human Capability Loop on open

**MISSING** · P2 · journey `J-human-capability-loop` · claimed missing

**Acceptance.** On open, one optional <=2-minute action from an approved goal with Do/Later/Skip/Edit/Why?; never silently alters habits; works without wearables.

Code: none

Note: Issue-sourced; not an owner chat message.
Sources: dash#29 comment 2026-10-21

## Claims that the code does not support

Agent reports and issue states that disagree with the code at the baseline.

| Id | Feature | Claimed | From code |
|---|---|---|---|
| DF-009 | Harness catalog adapters including pi and fx | implemented | partial |
| DF-018 | Provider fallback keeps Dash chats working | implemented | partial |
| DF-019 | Dev-server 500 and crash recovery | implemented | partial |
| DF-022 | One Send/Steer/Queue/Stop button at the text's leading edge | implemented | partial |
| DF-024 | Drafts persist across restarts and crashes | regressed | implemented |
| DF-026 | Multiline wrapping composer up to about six lines | missing | implemented |
| DF-035 | Opening a chat shows its real transcript; panes never empty | regressed | implemented |
| DF-049 | Shimmer status text lights the glyphs | implemented | partial |
| DF-058 | In-app dictation that stays inside Dash | regressed | implemented |
| DF-081 | Phones used as workers at full capacity | implemented | missing |
| DF-089 | Fast, quiet motion profile | implemented | partial |
| DF-097 | Dash as HITL approval surface with bulk approve and comments | missing | implemented |
| DF-099 | Needs OK in-chat permission approvals | implemented | missing |
| DF-109 | Fullscreen edge-to-edge | missing | implemented |

## Surface without a requirement

Code paths that no owner requirement covers. Keep, justify with an owner ask, or remove.

| Code | Surface | Note |
|---|---|---|
| `app/src/screens/LabScreen.tsx:41` | Component lab: variant picks, density/type-scale previews, stress animate20 vs cap6 | Owner only complained about its lag (DF on orb/lab smoothness); no owner ask defines its contents. |
| `app/src/components/TileGestures.tsx:57` | Tile gestures: double-tap pin, triple-tap copy, 350 ms radial wheel | The owner later replaced radial menus with row dropdowns for trace rows (H-093); pin/copy tiles have no requirement. |
| `app/src/screens/ArtifactStageScreen.tsx:21` | Artifact Stage: WebView/DOM review of tailnet stage URLs, dash://stage deep links | Hosts an external review app; only loosely related to the review-artifact asks (H-019). |
| `app/src/components/MessageRow.tsx:154` | Send host file to phone via bridge /share and KDE Connect | No owner ask; KDE Connect was mentioned only as an attachment transport idea (H-021). |
| `app/src/components/NeedsKevin.tsx:7` | Needs Kevin read-only supervision panel inside Approvals (60 s poll) | No owner requirement; legacy-token only, so identity pairing breaks it. |
| `app/src/components/BridgePull.tsx:76` | Pull-down bridge details: hosts, harness chips, Edit/Pair, retry | Useful status surface with no owner ask. |
| `app/src/screens/LegacyVoiceScreen.tsx:1` | LegacyVoiceScreen and WebSocket voice_* helpers | Unregistered/unreachable code; candidate for removal. |
| `app/src/debug/controller.ts:1` | Debug host, fixtures and scenario seeds | Dev tooling; must never render as live work (presence rule). |
| `app/src/mock/seed.ts:1` | Mock agents/orchestra/resources seed data | Demo data; must never appear as live work. |
| `bridge/gate-preview.ts:1` | Gate preview/seed scripts and DASH_GATE_* rehearsal split | Supports approvals but the rehearsal/live split has no owner ask. |
| `app/src/screens/OrchestraDetailScreen.tsx:20` | Project detail opened from a product search hit | Partly covered by the /live and project-detail entries; no direct owner ask for product search. |
| `app/src/lib/bots.ts:88` | COLLAPSED_KEY constant for Bots tree | Declared, never read or written; dead code. |
| `app/src/lib/mic-gesture.ts:73` | RECOGNIZE_SPEECH intent helpers | Exported but unused; the owner rule forbids the system recognizer popup. |
| `app/src/components/ContextCard.tsx:104` | Context compaction pulse animation | Ungated loop (no reduced-motion/background guard). |
| `app/src/components/trace/ActionChip.tsx:89` | Trace action chips Do/Not now with local-only decisions | Decisions never reach the host; the owner's approval asks are served by Approvals instead. |

## Requirement without surface

Owner requirements with no implementing code in this repo at the baseline.

| Id | Priority | Feature | Gap located at |
|---|---|---|---|
| DF-004 | P0 | Bridge-owned running chat must not show ended | `app/src/lib/live-sessions.ts:35` |
| DF-007 | P1 | Mesh auto-discovery of tailnet bridge hosts | `bridge/src/roster.ts:36`, `bridge/src/roster.ts:424` |
| DF-010 | P2 | Parallel tabs, usage hub, routing and runs (Empryo-inspired) | none |
| DF-012 | P0 | Failed sends are recoverable with Retry | `app/src/components/MessageRow.tsx:110` |
| DF-016 | P0 | PC reachable from Dash across reboots; phone stays connected | none |
| DF-025 | P1 | Paste an image into the composer auto-attaches | none |
| DF-036 | P1 | Select text and reply to it | `app/src/components/Markdown.tsx:29` |
| DF-041 | P2 | Rail tick spacing proportional to turn duration | `app/src/components/PromptRail.tsx:40` |
| DF-045 | P1 | History shows user text, not steer/queue wrapper | `app/src/lib/live-sessions.ts:66` |
| DF-061 | P0 | z0live screen understanding and in-app control | none |
| DF-062 | P2 | Gesture activation: Oura double-tap, call gestures, STT split | none |
| DF-063 | P2 | z0live conversation-quality experiments | none |
| DF-066 | P0 | S Pen button toggles annotation and normal mode | `app/src/lib/annotate/pointer.ts:5` |
| DF-067 | P2 | S Pen hover indication and micro-interactions | none |
| DF-070 | P0 | Turbo via Luna + uiautomator2: parallel ChatGPT chats on the S22 | none |
| DF-071 | P0 | Tell the owner what to test and take him to that screen | `app/src/lib/app-route-link.ts:1`, `app/src/lib/notification-routing.ts:1` |
| DF-074 | P2 | Five-effort ChatGPT benchmark feeding Turbo | none |
| DF-075 | P0 | Bugs blocking live Dash use are priority one | none |
| DF-076 | P0 | Watch agent auto-attaches while Dash is used | none |
| DF-079 | P2 | Separate OMP work queue coordinated with Hermes via ACP | `roadmap.yml:1` |
| DF-081 | P2 | Phones used as workers at full capacity | none |
| DF-084 | P2 | Standing test, accessibility and performance guard tracks | none |
| DF-094 | P2 | Zero card with nested agent trace above the composer | none |
| DF-099 | P1 | Needs OK in-chat permission approvals | `bridge/src/acp/client.ts:155`, `app/src/components/trace/TraceTimeline.tsx:514` |
| DF-103 | P2 | Night filter at sunrise/sunset | none |
| DF-121 | P2 | Human Capability Loop on open | none |

## Device journeys

| Journey | Proves | Features |
|---|---|---|
| `J-chat-list-all-harnesses` | Two tailnet hosts with Hermes (several profiles), OMP, Codex and Claude sessions, running and finished. Open Chats: every session appears once with host/harness identity; scrolling 1000+ rows keeps frame time under budget. | DF-001, DF-003, DF-009, DF-010 |
| `J-chat-search-fast` | With 1000+ chats loaded, type a query that matches a title, a message body and a remote-host session. Results appear within 200 ms of the last keystroke and open the right session. | DF-002, DF-006 |
| `J-chat-open-history` | Tap a live Hermes row and a live OMP row. The real transcript renders; panes are never empty; continuing sends into the same session id. | DF-035 |
| `J-send-receive-hermes` | Send three messages to a running Hermes session from Dash. Each reaches the host session once and the reply streams back. | DF-005, DF-017, DF-018, DF-020, DF-118 |
| `J-send-receive-omp` | Same as J-send-receive-hermes for an OMP session; Hermes path still passes afterwards. | DF-004, DF-013 |
| `J-send-failure-retry` | Kill the bridge mid-send. The message is kept with an explicit failed state; Retry delivers it once (no duplicate on the host). | DF-011, DF-012 |
| `J-steer-queue-merge` | While a Hermes turn runs, steer once, queue three, merge the queue, deliver. Order and text are preserved; steer reaches the active turn. | DF-014, DF-023, DF-045 |
| `J-composer-draft-restore` | Type half a sentence, force-stop Dash, relaunch. The exact draft is restored in the same chat. | DF-024 |
| `J-composer-paste-image` | Copy an image, long-press the composer and paste (and Gboard image insert). One attachment chip appears and is delivered with the next send. | DF-025 |
| `J-composer-attach` | Attach an image and a text file through the paperclip; both reach the agent readable. | DF-028 |
| `J-composer-suggestions` | Type / and @ on Main and inside a chat under identity pairing; real suggestions load and insert. | DF-027 |
| `J-composer-single-button` | Idle, drafting, running-empty and running-with-draft states show one leading-edge primary button (Send/Steer/Queue/Stop). | DF-022, DF-026 |
| `J-chat-window-open-close` | Tap a chat row: full-screen window over workspace, pill around camera cutout, attached dock, X in the handed corner. Close restores list position, draft and voice. | DF-031, DF-034, DF-037, DF-108 |
| `J-chat-identity-badge` | Tap the badge: host/harness/profile/session/model tree with source; switch target and confirm the backend session changed. | DF-038 |
| `J-context-card` | Under identity-only pairing open the context gauge; real usage renders and Compact works or says unavailable truthfully. | DF-039 |
| `J-thinking-tools-details` | Run a tool-heavy turn. Thinking/tool blocks are compact, descriptive, expandable as a tree, summarised, and the answer keeps streaming. | DF-043, DF-044 |
| `J-subagent-indicator` | Start a turn that delegates two workers. One main indicator plus a compact worker tree appears and updates to completion. | DF-046, DF-047, DF-112 |
| `J-prompt-rail` | In a 40-turn chat, scrub the rail with the keyboard open and closed; tick spacing follows turn duration; previews show prompt and result; jump to latest works. | DF-040, DF-041 |
| `J-markdown-code` | Render a reply with headings, lists, tables and fenced TS/bash code; formatting and syntax colours are correct. | DF-042 |
| `J-genui-render` | Ask for a mermaid diagram, a genui widget and an openui-lang block; each renders natively after a loader, never raw code. | DF-052, DF-053 |
| `J-live-surface` | Switch to Live surface, request an fx0 artifact, pick a version and send an intent; Hermes chat keeps control. | DF-054, DF-064 |
| `J-voice-live-call` | Tap Live on the mic in an attached Hermes chat: in-app call connects, barge-in works, mute/end work, no external popup, transcript reaches the same chat. | DF-048, DF-057 |
| `J-voice-dictation` | Dictate with the keyboard hidden; text is inserted at cursor, not sent; errors stay inside Dash. | DF-058 |
| `J-voice-mic-pill` | Hold mic, slide up/down, release: mode changes only; tap uses the mode. | DF-059 |
| `J-annotation-spen` | Enter annotation (Options or S Pen button), draw visible ink without scrolling, talk, send; the same chat receives screenshot+ink+speech; entry has no visible lag and the composer stays usable. | DF-065, DF-066, DF-067 |
| `J-annotation-agent-pointer` | Ask the agent where a feature is; it highlights the target and navigates there through an in-app API in the same chat. | DF-068 |
| `J-text-select-reply` | Select a range in a reply (or circle it with the S Pen) and reply; the reply carries exactly that quote. | DF-036 |
| `J-pairing-fresh` | Fresh install: pair by sound/magic link/agent onboarding once; Dash and z0live reuse the identity; all HTTP features work. | DF-021, DF-105 |
| `J-reconnect-reboot` | Reboot the PC and lock/unlock the phone; Dash reconnects authenticated without manual repair and replays missed events. | DF-015, DF-016 |
| `J-approvals-batch` | Ten proposed comments: bulk approve safe ones, review one, write one manual comment; swipe shows a completed state. | DF-097, DF-098, DF-099 |
| `J-orchestra-views` | Open Orchestra: real AODL network and live roster; views have real semantics; legend filters; node opens a real chat. | DF-051, DF-092, DF-096, DF-107, DF-117 |
| `J-trace-live` | Generate a backend event; the trace updates live and the detail shows ask, intent contract, receipts and artifacts. | DF-093, DF-094, DF-095 |
| `J-settings-density` | Change information density and layout density independently from the composer settings control; Orchestra controls live in the same menu. | DF-032, DF-100 |
| `J-settings-handedness` | Toggle Left/Right; close X, rail, mic and action menus mirror; the send button stays at the text's leading edge. | DF-101 |
| `J-fullscreen-launch` | Launch Dash: status bar hidden, edge-to-edge, revealed only by system swipe. | DF-109 |
| `J-notifications-share` | Background Dash, receive a reply notification, tap it to the exact chat; share a file from another app into a chosen chat. | DF-106 |
| `J-turbo-preview-brief` | Merge a worktree to preview: Metro hot-reloads the phone; Dash shows a compact brief of the feature and navigates to its screen. | DF-071, DF-072 |
| `J-turbo-chatgpt-fanout` | Trigger Turbo: N ChatGPT chats open on the S22, one per issue/worktree; the orchestrator reports created/completed counts and merges through the queue. | DF-070, DF-074, DF-081 |
| `J-dogfood-loop` | In dogfood mode capture a bug (S Pen/shake), see it fixed and hot-reloaded, confirm Fixed? in the same session. | DF-019, DF-069, DF-073, DF-120 |
| `J-watch-agent` | Start using Dash; a watcher attaches automatically and reports an error that appears in logcat/bridge logs before the owner reports it. | DF-076 |
| `J-design-conformance` | Screenshot every page at 390 and 800 px; tokens, glass and gold match DESIGN.md and owner reference screens. | DF-029, DF-033, DF-103, DF-111, DF-113, DF-114, DF-115, DF-116, DF-119 |
| `J-perf-profile` | S22/S25 gfxinfo + PSS over a 10-minute journey (scroll, chat, annotation entry, orbs): no sustained jank, no memory growth, loops stop when backgrounded. | DF-049, DF-086, DF-087, DF-088, DF-089, DF-090, DF-091 |
| `J-study-mode` | Open study mode on phone and web; a prompt yields an ephemeral UI (genui JSON and sandboxed fx0 tiers) and iterates; no app source edits. | DF-056 |
| `J-bots-tree` | Open Bots: hosts collapse/expand; harness vs bot/profile vocabulary is correct; rows open chats. | DF-008, DF-050, DF-110 |
| `J-roadmap-inline` | Ask for the Dash roadmap; a Ripple roadmap with per-feature progress bars renders inline in the chat. | DF-055 |
| `J-process-audit` | Run spec/check.py and the Bend laws: every owner ask maps to a DF entry with a journey; nothing is called done without an exact-SHA device receipt from a virtual-monitor E2E run. | DF-075, DF-077, DF-078, DF-079, DF-082, DF-083, DF-084, DF-085 |
| `J-privacy-forget` | Forget this bridge and Delete chat; no drafts, mic default, notification setting, trace feedback or voice cursor survive. | DF-104 |
| `J-model-roles` | Open Models; roles (judge/tiny/smol/large/default/vision/planning/orchestrating) and health render; change the model for this session from the composer. | DF-030, DF-080, DF-102 |
| `J-z0live-service` | Start z0live from Dash, Lawnchair and assistant; one service, shared pairing, transcripts reach Hermes. | DF-060, DF-061, DF-062, DF-063 |
| `J-human-capability-loop` | Open Dash with an approved goal: one optional <=2-minute action with Do/Later/Skip/Edit/Why? appears. | DF-121 |
| `J-mesh-discovery` | A second tailnet host runs the bridge; Dash lists it and its sessions without re-pairing. | DF-007 |
