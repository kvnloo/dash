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

Native Hermes still owns admission and model selection. Do not launch a second
classic CLI with `--resume`, take over another live writer or retry an ambiguous
send. No owner turn was sent during the read-only proof below.

## Replying from Dash (ordered handoff)

`bridge/src/hermes-continue.ts` is the only place that picks how Dash continues
an existing Hermes session. In order:

1. **Live owner check.** `bridge/src/hermes-owner.ts` reads Hermes's own lease
   registry, `<profile home>/runtime/active_sessions.json` (written by the classic
   CLI and TUI). It never takes the registry lock and never writes it. A lease
   counts only while its PID is alive and its start time matches. Leases cover the
   session's compression lineage. The roster marks such rows `openIn: "CLI"`, and
   the phone shows "Open in CLI on groot. Replies wait until it closes there."
2. **Held session: the reply waits.** The bridge emits a `status` event with
   `handoff: { state: "queued" }` ("Open in CLI on groot · reply queued until it
   closes") and writes nothing. It polls every 2 s. When the CLI exits normally
   (`/exit`), it emits `handoff: { state: "sending" }` and sends. Stop on the phone
   cancels the queued reply before anything is sent. A wait over 12 h ends with an
   explicit "not sent" error. A bridge restart drops queued replies (the phone shows
   them as interrupted); nothing is sent.
3. **Transport.** Native API (`/api/sessions/{id}/chat`) when the profile has a
   host-only key, otherwise Hermes's own ACP server (`hermes acp`, `session/load`
   then `session/prompt`) under that profile's `HERMES_HOME`. Never a classic CLI.
4. One Dash continuation per profile session at a time, queued or running.

New Hermes chats start through Hermes ACP in the bridge's own `HERMES_HOME`. Their
`session` event carries `hermes:session:<profile>:<id>`, so the next roster refresh
merges into the same phone chat instead of adding a duplicate row.

**z0bridge seam.** The Hermes ACP bridge (`kvnloo/z0bridge`, built separately) plugs
in as another `HermesRoute` kind in `chooseHermesRoute`. Only z0bridge could take a
turn *into* a live owner; until it exists, Dash waits for the owner to close.

Proof on a throwaway session (never the owner's sessions):

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
