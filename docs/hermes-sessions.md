# Real Hermes chats in Dash

## What changed

Dash used to list Hermes **profiles**, not their sessions. Saved phone threads were
never reconciled when an OMP daemon disappeared. They could look current forever.
The OMP daemon reader still requires both broker files and a live PID. It does not
revive old OMP history merely because a daemon directory exists.

`bridge/src/hermes-sessions.ts` now enumerates the default Hermes home and every
named profile under `~/.hermes/profiles`. `DASH_HERMES_ROOT` can select another
root explicitly. Discovery deduplicates symlinked homes. It returns at most 50
recent visible conversations per profile, with native title, profile, source,
last activity (milliseconds), message count and cwd.

The explicit interactive-source allowlist is `HERMES_CHAT_SOURCES` in that module.
It includes `local` (the owner's native session-authority CLI), `cli`, `tui`,
`desktop`, `acp`, `api_server`, gateway/web and the supported messaging platforms.
It excludes kitchen, oneshot, cron, kanban, tool and subagent sources. Hidden,
archived and delegate-provenance rows are excluded. Persisted Hermes sessions
are `available`, **not** advertised as running processes.

### Chats row content

Chats rows show the supplied title, working-folder name, activity and a literal
excerpt from the latest nonempty completed assistant reply. The excerpt is labeled
**Last reply**, not an inferred summary or verified outcome. It uses the first
sentence of the first nonempty line. Pending, streaming, interrupted and failed
replies never replace that excerpt. A row without a completed reply says
**No summary yet**.

The current conversation contract supplies `cwd`, not git root, branch or a repo
list. Rows therefore label it **Folder** and preserve the full path in its
accessibility label. Missing cwd says **Folder unknown**. No repo membership is
inferred from paths or message text. Thinking-block summaries are not conversation
summaries and are not used here.

Activity distinguishes running turns, queued sends, host handoffs and unknown
connection state. A live host process alone does not mean that a turn is running.
The row press, long-press and navigation callbacks remain unchanged. The debug
seed `chat-rows` covers a rich row, a folder-less row, a no-summary row and a
running row. `scripts/chat-rows-proof.mjs` captures the real Expo web Chats pane.

## Reused boundaries

- Like z0live's `desktop/z0live_desktop/work_sources.py`, fallback discovery and
  history open each existing `state.db` read-only, with `query_only` and a short
  busy timeout. No database is created, migrated, rewritten or copied.
- Prefer each profile's reachable native `GET /api/sessions`, with bounded
  pagination and native `/messages?limit=200&order=latest`. Native API JSON omits
  cwd, so the local read-only row enriches that field. API failures fall back to
  SessionDB. Named profiles must prove their endpoint knows a native session ID;
  copied default ports/keys must not silently return the default profile's chats.
- Like garden's Hermes link, the phone talks only to Dash's existing authenticated
  bridge. Native Hermes endpoints and secrets stay on loopback and on the host.
  A host-only key-file mapping can reuse an API-only host without starting another
  gateway, cron scheduler or messaging adapter.
- Continuing an existing session uses the existing `hermes-session.ts` transport,
  now with the native `/api/sessions/{id}/chat` lane. The exact profile/session is
  resolved on the host and checked with GET before POST. A session has at most
  one Dash API turn in flight. Failures, ambiguous outcomes and queued receipts
  do not trigger another transport or a CLI resume. Existing-session sends do
  not depend on `DASH_ENABLE_LEGACY_CLI`.

Native Hermes still owns admission and model selection. Do not run a second
agent beside a live writer (a classic in-process CLI `--resume`), take over another
live writer or retry an ambiguous send. Hermes's thin gateway client is a viewer,
not a writer (see below). No owner turn was sent during the read-only proof below.

## Replying from Dash (live gateway sessions, ordered handoff otherwise)

`bridge/src/hermes-continue.ts` is the only place that picks how Dash continues
an existing Hermes session (`planContinuation`, then `chooseHermesRoute`).

Current Hermes runs every classic CLI and TUI turn inside the profile's gateway.
The terminal is a thin viewer (`hermes_cli/gateway_agent.py`): the CLI writes a
`cli` lease under its own pid and holds a loopback WebSocket to the gateway; the
TUI writes no lease; the gateway's own `gateway:local` lease (gateway pid) appears
while a turn runs. All of them are clients of one gateway FIFO per session.

1. **Live owner check.** `bridge/src/hermes-owner.ts` reads Hermes's lease
   registry, `<profile home>/runtime/active_sessions.json`, without its lock and
   without writing. A lease counts only while its PID is alive and its start time
   matches. Leases cover the session's compression lineage. The roster marks such
   rows `openIn: "CLI"`.
2. **Where the owner's agent runs** (`bridge/src/hermes-gateway-host.ts`, read-only
   `/proc` and `gateway_state.json`). `gateway` when a running gateway serves the
   profile (`served_profiles` or its own `hermes_home`) and the lease pid is that
   gateway, or holds an established loopback TCP connection to a port it listens
   on, or the session is a native session-authority chat (`source = 'local'`).
   Anything else is `standalone`.
3. **Gateway-hosted (`live`): send now, into that gateway.** Also for a `local`
   session with no lease (an open TUI or Desktop). The bridge shows "Open in CLI on
   host-b · sending into the live session" when a lease exists. The bridge runs
   `bridge/src/hermes-live.py`, bootstrapped with `hermes --print-runtime-command`.
   `DASH_HERMES_SOURCE` selects the Hermes source tree (default
   `/workspace/hermes-home/hermes-agent`). Text travels only on stdin.
   The helper sets `HERMES_DISABLE_LAZY_INSTALLS=1` before runtime discovery and
   bootstrap, so a send does not install dependencies or finish a source update.
   `HERMES_HOME` selects the profile and `HERMES_TUI_GATEWAY_URL` is removed.
   Discovery attaches only to an existing gateway. It never starts an agent or gateway.
   The helper resumes the session and admits text on its durable FIFO.
   An idle session runs it next; a running session queues it.
   Hermes's `GatewayChatView.run(oneshot=True)` and `StreamJsonEmitter` retain
   admission filtering, terminal result/exit codes, control detachment and replay-gap recovery.
   A narrow client adapter removes `finite` only from `prompt.submit`.
   The viewer follows one admission, but the turn is a long-lived chat turn.
   Async delegates and background completion notifications therefore remain available.
   The gateway ACP projection is not used because it includes other viewers' deltas.
   The TUI paints Dash's turn live. Stop on the phone detaches the helper.
   Accepted queued or running work remains at the gateway. Do not resend it.
4. **Standalone owner: the reply waits.** Only a process that runs its own agent
   (no serving gateway, no link to it) keeps the ordered handoff: a `status` event
   with `handoff: { state: "queued" }` ("Open in CLI on host-b · reply queued until
   it closes"), nothing written, a 2 s poll, `handoff: { state: "sending" }` once it
   exits. Stop cancels before anything is sent; a wait over 12 h ends with an
   explicit "not sent" error; a bridge restart drops queued replies, sending nothing.
5. **Other transports.** Native API (`/api/sessions/{id}/chat`) when the profile has a
   host-only key, otherwise Hermes's ACP server (`hermes acp`, `session/load` then
   `session/prompt`) under that profile's `HERMES_HOME`. Never a classic CLI that
   runs its own agent.
6. One Dash continuation per profile session at a time, queued or running.

### Clarification and approval controls

Dash no longer marks these turns finite. Previously, finite turns returned the
headless clarify result immediately, without waiting for a human answer.
Now a non-finite turn can wait for a clarification answer.
The helper does not request `clarify_batch`, so Hermes publishes per-question
`clarify.request` controls. Hermes's one-shot viewer detects a pending clarification
or approval and detaches without cancelling, with a terminal `result` and exit code 3.
Dash tells the user to answer in Hermes TUI/CLI and not resend the message.
Dash does not implement a control-answer surface in this transport.

The underlying turn remains pending until a viewer answers, an interrupt occurs,
or the configured clarify timeout expires. Hermes resolves that timeout from
`clarify.timeout`, then `agent.clarify_timeout`, then 3600 seconds.
Zero or a negative value means unlimited waiting. On timeout, the tool reports
`outcome: timed_out` with unanswered questions and the turn can continue.
Later results remain visible in the session history, not in the detached Dash stream.
Attended approval rules also apply again. No control is auto-approved by this helper.

The helper retains the session's existing source label. Omitting `finite` removes
the admission-level unattended override; it does not turn automation-source sessions
into attended human sessions. The steer helper and `session.steer` route are unchanged.

Unit proof (no gateway connection):

```sh
bun test bridge/src/hermes-live.test.ts
DASH_HERMES_SOURCE=/workspace/hermes-home/hermes-agent \
  <python-from-hermes-print-runtime-command> -I bridge/src/hermes-live.test.py
```

The native Python tests use the real Hermes viewer and emitter with a fake client.
They pin admission flags, foreign-admission filtering, blocking controls,
unknown-turn refusal, and replay-gap recovery. They do not submit to a real session.

New Hermes chats start through Hermes ACP in the bridge's own `HERMES_HOME`. Their
`session` event carries `hermes:session:<profile>:<id>`, so the next roster refresh
merges into the same phone chat instead of adding a duplicate row.

**z0bridge seam.** The Hermes ACP bridge (`kvnloo/z0bridge`, built separately) plugs
in as another `HermesRoute` kind in `chooseHermesRoute`. Live gateway sessions do not
use it (it is ACP, with the same foreign-delta projection).

**Upstream gap (hermes-tern lane).** Hermes has the client half of "attach a second
terminal to a live session" (`hermes_cli/shared_session_attach.py`, lease
`metadata.shared_runtime_url` + `/api/session-attach`), but no runtime advertises
`shared_runtime_url` or serves that handshake, the classic CLI does not paint other
viewers' turns, and the ACP projection does not tag deltas by admission.

Live proof against scratch sessions in a private tmux socket (never the owner's):

```sh
TMPDIR=<scratch> HERMES_HOME=~/.hermes/profiles/clean \
DASH_PROOF_TARGETS='[{"sessionId":"local-…","tmux":"dashproof","pane":"tui:cli","paints":false,"busy":true},{"sessionId":"local-…","tmux":"dashproof","pane":"tui:1","busy":true}]' \
bun scripts/verify-hermes-gateway-live.ts
```

Observed 2026-10-21 on host-b (gateway pid 351541 serving `clean`): CLI-leased
session idle and mid-turn, TUI session idle and mid-turn; all `transport: gateway`,
exit 0, reply `pong` in the bridge stream and as the session's newest assistant
row, no handoff queued, no foreign text; the TUI's newest reply became `pong`
(mid-turn: after its own `sleep 20` turn finished, 21-26 s).

Standalone-owner handoff proof (an owner that runs its own agent; with current
gateway-hosted Hermes its CLI leg now goes live instead of queueing):

```sh
TMPDIR=<scratch> HERMES_HOME=~/.hermes/profiles/clean bun scripts/verify-hermes-handoff.ts
```

It creates a new session from Dash (ACP), replies into it, opens it in a real classic
CLI in a private tmux socket, checks that the reply queues and the transcript is
unchanged while the CLI is open, exits the CLI with `/exit`, and checks delivery.
Observed 2026-10-20: ALPHA/BRAVO/CHARLIE replies, 4 messages while held, 6 after.

History carries host and profile identity. Only user/assistant text crosses that
contract; tool output and reasoning fields do not. The DB fallback reads the
latest 200 visible messages, following compression-only ancestry/continuations,
not delegated workers. Native history uses Hermes's own compression projection.

## Phone reconciliation

Every successful roster refresh (including a 10-second foreground poll) reconciles
saved conversations. Missing sessions become `stale: true`, retain their messages,
and show muted text plus **ended**. Returning sessions revive the same row.
Failed fetches/disconnects are not empty roster snapshots. Host/profile/session
identity prevents one profile's chat or history from shadowing another's.

Hermes rows use their real title and activity time in the existing Today/Yesterday
sections, show the profile, and refresh history when opened or while active.
**Clear ended** removes only ended phone records. It does not delete host history.
Normal deletion remains phone-local.

## Host configuration

Profiles with `API_SERVER_*` in their own `.env` need no extra configuration.
Do not inherit another profile's Hermes credentials. For API-only hosts with keys
stored outside `.env`, set a host environment mapping (URLs must be loopback HTTP):

```sh
export DASH_HERMES_APIS='{"clean":{"url":"http://127.0.0.1:8643","keyFile":"/mnt/zer0models/workspace/zer0/products/garden_room/data/voice/.hermes-api-key"}}'
```

This reuses the existing garden clean host. It does not expose port 8643 or its
full-tool API to the phone. Keep its key file private. Without a matching native
API, a profile's history is still readable; sending fails explicitly rather than
resuming through an unsafe CLI fallback.

## Reproduce the isolated read-only proof

From this worktree, with the mapping above exported:

```sh
DASH_VERIFY_HERMES_PROFILE=clean \
DASH_VERIFY_HERMES_SESSION=local-be1ae19e1fe2aeb65efacd2b44cd17aa9acca60c3024abc995c9221bd263c503 \
bun scripts/verify-hermes-sessions.ts
```

The script owns only a bridge on `127.0.0.1:4799` and disposable private
credentials under `TMPDIR`. It verifies HTTP auth, HTTP roster, WS hello, scoped
WS history, equality to the native title/latest visible message, and stale-OMP
reconciliation. It prints only titles, IDs, counts and booleans. Its finally block
stops that bridge and removes its credentials. It never pairs with, stops or
restarts the owner's bridge/Metro, or writes a message to the owner's session.

Observed proof: title **Debug Hermes crashing**, profile **clean**, 149 Hermes
sessions listed, 37 projected history messages, latest native message ID
**174067**, with matching returned IDs **173838, 174040, 174067**. Unauthenticated
roster: **401**. HTTP and WS both listed the owner's exact ID. The isolated port
was unbound again after the proof. Counts/IDs naturally change as the owner chats.

## Swap the owner's bridge (operator only; not performed by this PR)

1. Integrate this PR and the independent UI branch in the operator's chosen tree.
   Do not reset or overwrite either worktree. Make Metro serve the combined app
   code; a bridge-only restart cannot update the phone's reconciliation code.
2. Confirm the listener with `ss -ltnp '( sport = :4747 )'`. At proof time it was
   PID **1883422**, `bun index.ts`, cwd
   `/mnt/zer0models/workspace/zer0/products/dash/.worktrees/approvals-gate/bridge`.
   There was no `dash-pair.service`. Do not assume the same PID later.
3. Stop only that verified bridge PID with `kill -TERM <verified-pid>`. Wait for
   port 4747 to be unbound. Leave Metro and all Hermes/garden services alone.
4. Start the combined tree's bridge from its `bridge/` directory, preserving the
   owner's existing credentials and approval-gate modes:

   ```sh
   DASH_HOST=100.113.138.100 DASH_PORT=4747 \
   DASH_GATE_ENABLED=1 DASH_GATE_LIVE=0 DASH_GATE_OWNER_DECISIONS=1 \
   DASH_CREDENTIAL_DIR=/home/kvn/.dash \
   DASH_HERMES_APIS='{"clean":{"url":"http://127.0.0.1:8643","keyFile":"/mnt/zer0models/workspace/zer0/products/garden_room/data/voice/.hermes-api-key"}}' \
   bun index.ts
   ```

   Use the operator's existing tracked process runner. Do not create another
   listener or re-enroll the phone. The command contains a key-file **path**, not
   its value. Keep any other existing nonsecret bridge settings unchanged.
5. Read `/roster` with the existing `/home/kvn/.dash/token` loaded privately into
   an Authorization header. Verify the exact owner ID and title above. Reload
   Expo Go after Metro serves the combined app. Open that chat; its profile and
   recent history should appear, and old OMP chats should say ended. No re-pair.

## z0bridge (preferred when running)

When the host runs [z0bridge](https://github.com/kvnloo/z0bridge) (`bun src/cli.ts serve`,
loopback `127.0.0.1:4787`, token in `~/.config/z0bridge/token`, mode 0600), Dash's bridge uses it
for Hermes **listing**, **history** and **continuing** existing sessions
(`bridge/src/z0bridge-hermes.ts`). z0bridge speaks ACP to one `hermes -p <profile> acp` child per
profile. Those children are viewers of each profile's gateway, the single execution owner, so a
turn enters Hermes's own per-session FIFO.

- **Fallback.** If the token file is missing, group/other readable, the URL is not loopback, or
  `GET /v1/health` fails, Dash keeps the native API / read-only SessionDB path above unchanged.
- **No double sends.** Once z0bridge accepts or refuses a turn, that answer is final. A refusal
  (`live_elsewhere`, `turn_in_flight`, `cwd_unknown`, ...) is shown to the phone. It never falls
  back to the native API or a CLI.
- **Live sessions.** Dash sends `onLive: "queue"`, matching the native API, which also queues
  behind the live owner. Set `DASH_Z0BRIDGE_ON_LIVE=refuse` to refuse instead.
- Session events report `transport: "z0bridge"`. Streaming text, tool status and cancel go
  through z0bridge's SSE and `POST /v1/turns/:id/cancel`.
- Config: `DASH_Z0BRIDGE=0` disables it. Optional `DASH_Z0BRIDGE_URL` and
  `DASH_Z0BRIDGE_TOKEN_FILE` set the URL and token file. `bridge/src/z0bridge/{types,client}.ts`
  are vendored from z0bridge (see the header SHA). Re-copy them when you upgrade.
- New Hermes sessions from the phone still use the existing ACP supervisor path.

Live proof (owns ports 4790/4798 and one throwaway session, which it archives):

```sh
Z0BRIDGE_REPO=/path/to/z0bridge TMPDIR=/private/scratch bun scripts/verify-z0bridge-hermes.ts
```

Observed: roster listed the throwaway session through z0bridge. A WS `chat` replied `pong` with
`transport: "z0bridge"`, `done` exit 0. History returned 2 messages. Then the session was archived.
