# Persisted sessions

Sessions that already exist on the host appear without the user creating them: an OMP session from a discoverable process, and a Hermes session from its SQLite row (titled `ARMY native fixture`). The user opens one, sees its earlier messages load, and a new send continues the same session.

Status: UNCOVERED (no committed army test drives it; the committed tests only check the fixture rows exist at bridge start)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-04-05-sending-to-every-harness.spec.ts` › "persisted OMP session: the discoverable process is listed, opening loads history, a send continues the same session"; "persisted Hermes session: the SQLite row is listed, opening loads history, a send continues the same session"

## Sub-features

- `persisted-omp` OMP session listed, history loads, send resumes `army-fixture-session` [UNCOVERED]
- `persisted-hermes` Hermes SQLite row listed in Chats and Bots, history loads, send resumes it [UNCOVERED]

## How to get to it (user POV)

- Chats tab: the row `ARMY native fixture`; or the Bots tab tree under the host, then the session row.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Default `persistSession:true`: `fixtures.ts` waits for `/roster` to list `omp:` and `hermes:session:default:army-fixture-session`. Seeded history messages need extra fixture writes (a message row in `state.db`, a line in the OMP session file), which the draft adds.

- **Listed.** `await pair(page,bridge)`; `page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({has:page.getByText('ARMY native fixture')})` has count 1.
- **Open.** Click the row; the chat window opens with an editable `composer(page)` and the harness badge.
- **History.** After the seeded messages are written, the marker text is visible in the transcript.
- **Continue.** `send(page,'continue hermes session')`; `ARMY_REPLY:` appears, and `bridge.log` shows a `session/load` for `army-fixture-session` (not a new session).
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/persisted-sessions.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`, `fixture-roster.json` (in the bridge's temporary dir). They must show the earlier message in the transcript and the continuation reply on the same session id.

## Gotchas

- Use the row filtered by title `ARMY native fixture`, never the first row.
- The OMP row is a fixture holder process in the bridge's PID namespace; it needs `persistSession:true` and disappears with `persistSession:false`.
- `wire.got` frame checks in the draft read the real WebSocket; they depend on `history` frames, not on UI text alone.
- The draft's Bots-tree locators (`tree-row-<host>:session:<id>`) are generated from `lib/bots-tree.ts`; confirm the ids in the trace before relying on them.
