# New agent: every harness, Cursor cloud and bots

The **New agent** button (the plus-circle in the Main header, label "New agent") opens a sheet
of everything the paired computer can start. Tapping a row creates a chat; its first message
launches the agent on the host.

| Section | Rows | Source |
|---|---|---|
| Harnesses on `<host>` | every catalog harness (`bridge/src/harnesses.ts`), installed or not | hello / pairing `harnesses` |
| Cloud | Cursor Cloud | `HarnessInfo.where === "cloud"` |
| Bots on `<host>` | Hermes gateway profile bots, GrokBot, other bots (read-only) | `HostInfo.bots[].spawn` |

Unavailable rows stay listed and disabled with the host's reason (`HarnessInfo.hint`,
`BotSpawn.hint`), for example "Set CURSOR_API_KEY on the host".

## Cursor cloud agents

`bridge/src/cursor-cloud.ts` speaks Cursor's public background-agents API (v0):

- First turn: `POST /v0/agents` with `{prompt:{text}, source:{repository[, ref]}[, model]}`. The
  agent id becomes the chat's session id; the session event carries profile
  `cursor-cloud:<agent id>` and transport `cloud`.
- Later turns: `POST /v0/agents/{id}/followup`.
- Each turn polls `GET /v0/agents/{id}` and `/conversation` and streams new assistant messages
  as reply text until the agent is `FINISHED` (or `ERROR`/`EXPIRED`, reported as an error).
  Stop sends `POST /v0/agents/{id}/stop`.
- Recent agents (`GET /v0/agents?limit=20`, cached 15 s, never blocking) are roster rows of kind
  `cursor-cloud`, so running ones show in Chats.

Host env (the key never leaves the host and is never logged):

| Variable | Meaning |
|---|---|
| `CURSOR_API_KEY` | Cursor API key. Without it the harness is listed as unavailable. |
| `DASH_CURSOR_REPOSITORY` | GitHub repository for new agents. Default: the chat folder's GitHub `origin`. |
| `DASH_CURSOR_REF` | Optional base branch/ref. |
| `DASH_CURSOR_MODEL` | Optional model id. |
| `DASH_CURSOR_POLL_MS` | Poll interval, default 3000. |
| `DASH_CURSOR_API_URL` | Another API origin (the army's fixture server). |

## Bot spawn targets

`bridge/src/bots.ts` `withSpawnTargets` adds `BotInfo.spawn = {harness, profileId, available}`:

- Hermes gateway profile bot `<p>`: a new Hermes ACP chat with `HERMES_HOME` set to that
  profile's home. The phone sends profile `hermes:<p>`; the bridge accepts it only for a new chat
  in a profile it knows (`spawnProfileRoute` in `bridge/index.ts`). Replies continue through the
  normal Hermes session route (`hermes:session:<p>:<id>`).
- GrokBot: a new Grok ACP chat. It is listed whenever the Grok harness is installed, and shown
  as running when the GrokBot desktop process is.

Proof: army journey `e2e/mbp-army/new-agent-every-harness.spec.ts` with the Cursor API stand-in
`e2e/mbp-army/fixture-cursor-cloud.ts`.
