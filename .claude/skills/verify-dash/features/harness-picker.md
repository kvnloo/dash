# Harness picker

Each chat runs on a harness (OMP, Hermes, Claude Code, Codex, Grok, Pi, fx). New chats start on OMP. The user switches harness from the chat's Options menu (windowed chat) or the `Choose harness` chip (full-screen chat); unavailable harnesses are listed but disabled. Switching changes the badge and the composer placeholder without sending anything.

Status: COVERED by `e2e/mbp-army/army.spec.ts` › "harness picker switches OMP to Hermes without sending"
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-04-05-sending-to-every-harness.spec.ts` › "harness picker: new chat defaults to OMP, unavailable rows are disabled and inert, Close dismisses"; "switching harness saves the default; reopening a harness reuses its empty chat instead of duplicating"

## Sub-features

- `picker-switch` switch OMP to Hermes, badge and placeholder follow, Send stays disabled with an empty box [covered: "harness picker switches OMP to Hermes without sending"]
- `picker-default-omp` new chat chip reads `OMP · Change` [UNCOVERED]
- `picker-unavailable` rows named `<Name>, unavailable` are disabled, caption `Not installed on the bridge machine` [UNCOVERED]
- `picker-close` `Close harness picker` dismisses with harness unchanged [UNCOVERED]
- `picker-default-saved` the last choice becomes the default for the next new chat [UNCOVERED]
- `picker-reuse-empty` reopening a harness reuses its empty chat instead of making a duplicate [UNCOVERED]

## How to get to it (user POV)

- Windowed chat: Options button, then `Harness`, then a row.
- Full-screen chat (from `Create new chat`): the chip `Choose harness` at the top.
- Search box: type `/harness Claude` and tap the result.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The committed fixture installs only `omp` and `hermes`; Claude Code, Codex and Grok rows are unavailable unless a spec writes wrapper binaries into the bridge's `bin` dir (see harness-send-matrix).

- **Switch.** `await openChat(page,bridge); await chooseHarness(page,'Hermes')` (clicks `Options. Current surface: Chat`, then `Harness, …`, then the row). `getByTestId('chat-window-badge')` contains `Hermes`; `composer(page)` placeholder matches `/Hermes/`; `Send` is disabled.
- **Unavailable.** Open the picker; `getByRole('button',{name:'Pi, unavailable',exact:true})` is disabled; `getByRole('button',{name:'Close harness picker',exact:true})` closes it.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "harness picker switches OMP to Hermes without sending"`
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. They must show the Hermes badge and placeholder, and `bridge.log` must contain no turn.

## Gotchas

- `chooseHarness` matches the last button whose name matches the regex; `Claude` could also match `Claude Code, unavailable` rows, so use exact names for the draft journeys.
- The `Choose harness` chip exists only in the full-screen chat (`ChatScreen.tsx`, not windowed); the draft's `openFullscreen` uses `Create new chat` for it.
- Draft journeys that expect Claude Code, Codex and Grok enabled depend on wrapper binaries the committed `fixtures.ts` does not install, and on a `createBridge(persist, legacy, env)` signature the committed one lacks.
