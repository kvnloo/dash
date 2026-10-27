# Sending to every harness

A user can send from a new chat on any installed harness and see a streamed reply, with a clear error and a usable composer when the agent fails. Settings lists every harness the bridge knows with an installed or not found label and a green or faint dot. Pi and fx only run in legacy CLI mode.

Status: UNCOVERED (no committed army test drives it; the committed tests only send on OMP and Hermes)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-04-05-sending-to-every-harness.spec.ts` › "Claude Code: pick it, send, the reply streams from the claude harness and completes" (and the Codex, OMP, Hermes, Grok variants); "harness error: a Claude Code fixture error shows on the reply and the composer is usable again"; "Settings lists every bridge harness: ACP adapters installed (ok dot), pi and fx not found (faint dot)"; "Pi: pick it, send, the reply streams from pi and completes; …"; "fx: pick it, send, …". Also `e2e/mbp-army/rc3-send-longpress.spec.ts` › "send to a NEW Claude Code (claude) chat gets a streamed reply"; "archived Claude Code chat recorded on this host" › "opens sendable (not view-only) from Chats and gets a streamed reply"

## Sub-features

- `send-hermes` pick Hermes and send [UNCOVERED] (the committed steer test sends on Hermes but asserts steering, not the reply)
- `send-claude` new Claude Code chat gets a streamed reply [UNCOVERED]
- `send-claude-archived` an archived Claude Code chat recorded on this host opens sendable, not `View only` [UNCOVERED]
- `send-codex-grok` Codex and Grok chats [UNCOVERED]
- `send-pi-fx` legacy CLI Pi (resumes its session on the next send) and fx [UNCOVERED]
- `settings-harness-list` Settings `Harnesses on <host>` rows with ok/faint dots [UNCOVERED]
- `harness-error` per-harness error shown, `Stop` gone, composer sends again [UNCOVERED] (OMP version is covered by "real ACP error is surfaced visibly and leaves composer usable", see agent-errors)

## How to get to it (user POV)

- `Create new chat`, pick a harness (see harness-picker), type and Send.
- Settings: the gear (`Open settings`), scroll to `Harnesses on <host>`.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The bridge needs a fixture wrapper for each harness binary (`claude-agent-acp`, `codex-acp`, `grok`, and `pi`/`fx` with `DASH_ENABLE_LEGACY_CLI=1`) in its private `bin` dir that execs `fixture-agent.ts`. The committed `fixtures.ts` hard-codes `DASH_ENABLE_LEGACY_CLI=0` and only installs `hermes` and `omp`, so the spec must add this.

- **Claude Code new chat.** `await pair(page,bridge)`; click `getByRole('button',{name:'Create new chat',exact:true}).first()`; click `getByRole('button',{name:'Choose harness',exact:true})` then `getByRole('button',{name:'Claude Code',exact:true})`; the placeholder matches `/Claude Code/`; `await send(page,'ARMY_SLOW claude new chat ping')`. `ARMY_STREAM_BEGIN` then `ARMY_CLAUDE_REPLY: …` (this reply prefix needs the draft's fixture). `bridge.logs()` matches `ws.chat id=\S+ harness=claude ` and not `turn.rejected`.
- **Archived Claude.** With `archiveClaude:true`, the Chats row `ARMY archived Claude Code chat` opens with no `View only` text and an editable composer; send gets a reply and the log shows `harness=claude … session=resume`.
- **Error.** `send(page,'ARMY_ERROR claude harness failure')`; `ARMY_EXPECTED_AGENT_ERROR` visible, `Stop` count 0, then a normal send replies.
- **Settings.** `getByRole('button',{name:'Open settings',exact:true})`; rows by `getByLabel('Claude Code, installed',{exact:true})` or `'Pi, not found'`; dot color ok `rgb(152, 207, 139)`, faint `rgb(94, 91, 82)`.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/harness-send.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. They must show the reply, and `bridge.log` must show `ws.chat … harness=<id>` with the right harness and no `turn.rejected`.

## Gotchas

- Without wrapper binaries those harnesses are `unavailable`, so the picker row is disabled and the journey fails at the pick; that is a fixture gap, not an app bug.
- The `ARMY_CLAUDE_REPLY:` prefix, `army-harness-calls.jsonl` and `createBridge` env overrides used by the drafts are not in the committed fixtures; expect failure until a spec supplies them.
- Pi and fx run only with `DASH_ENABLE_LEGACY_CLI=1`; Codex and Grok are ACP-only, so they read `not found` in legacy mode.
- Settings dot colors depend on the theme palette; if the theme differs, assert the label, not the color.
