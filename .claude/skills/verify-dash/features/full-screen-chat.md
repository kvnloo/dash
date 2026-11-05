# Full-screen chat

Create new chat opens a chat that fills the screen under the top nav, with a compact header, a composer, and an empty state (agent orb, harness name, "on <host>") until the first message. Back returns to Main with the new chat in the Chats list. An RC3 status pill with a close X is built but not mounted yet.

Status: COVERED by `e2e/mbp-army/army.spec.ts` › "pairing, Chats tab, open and close real chat window"
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-02-03-chat-screen-chrome-header-full-screen.spec.ts` › "03.01 new chat from workspace header opens full screen with top nav, compact header and back to Main"; "03.02 empty full-screen chat shows agent orb, harness name and host line"; "03.03 RC3 #392/#383 full-screen status pill shows title+status and its close X returns to Main"; "03.09 targetError shows an alert under the header and disables the composer"; "03.10 host-handoff session (openIn) shows the session viewer note"

## Sub-features

- `fs-open-back` Create new chat opens full screen; Back lands on Chats with a `New chat` row. [covered: "pairing, Chats tab, open and close real chat window"] (inside `openChat()`)
- `fs-compact-header` top nav stays and the heading shows the chat or harness name. [UNCOVERED]
- `fs-empty-state` `agent-orb`, harness name and `on <host>` in an empty chat. [UNCOVERED]
- `fs-status-pill-close` status pill and close X. [UNCOVERED] Not mounted.
- `fs-target-error` alert and disabled composer when the host ends the session. [UNCOVERED]
- `fs-session-viewer-note` "Also open in TUI on <host> · reply here to continue". [UNCOVERED]

## How to get to it (user POV)

- Chats workspace header > Create new chat.
- The Bridge sheet's New <harness> chip opens a full-screen chat too (see `bridge-pull-sheet.md`).

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- `pair(page, bridge)` (Chats tab selected).

- **Open.** `await page.getByRole('button',{name:'Create new chat',exact:true}).click({noWaitAfter:true})`. `composer(page)` is visible and `getByTestId('chat-window')` has count 0.
- **Back to Main.** `await page.getByRole('button',{name:'Back',exact:true}).click({noWaitAfter:true})`. `getByTestId('chats-pane')` shows exactly one `chat-row-*` row containing `New chat`.
- **Empty state (not driven).** `getByTestId('transcript-viewport').getByTestId('agent-orb')` is visible, plus a text matching `/^on \S+/`.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "pairing, Chats tab, open and close real chat window"`
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. The video must show the composer filling the screen, then Back and the new row in Chats.

## Gotchas

- Expected FAIL at 2c948dc for draft 03.03: `chat-fullscreen-pill`, `chat-fullscreen-pill-title` and `Close chat` exist in `FullscreenChatChrome.tsx` but nothing imports it, so ChatScreen never mounts it.
- Draft 03.09 and 03.10 depend on the fixture session `army-fixture-session` and on editing the isolated bridge's Hermes state while it runs, which the committed fixtures do not do; run them as written only after adding that helper.
- Back is a button named `Back`; two exist when a window hides a pane, so use `.first()` or scope to the screen if strict-mode complains.
- "Ask anything" appears in the empty state only while offline.
