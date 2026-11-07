# Dash

Phone app (Expo) that talks to the coding agents on your laptop over Tailscale.

Black UI, one chat thread per harness (OMP, Codex, Grok, Hermes, Claude Code when installed). Streams replies live; reconnects after the screen locks.

## Quick start (laptop)

```bash
# 1. Bridge — runs agent CLIs, listens on your tailnet
cd bridge && bun install && bun run index.ts
```

On first run the bridge prints:

- **Address** — your Tailscale IPv4, port `4747` (override with `DASH_PORT`)
- **Token** — stored in `~/.dash/token`; pass as `?token=` on the WebSocket URL

Optional env:

| Var | Default |
|-----|---------|
| `DASH_PORT` | `4747` |
| `DASH_HOST` | `0.0.0.0` (LAN + Tailscale) |
| `DASH_CWD` | directory you launched from |

```bash
# 2. App — scan QR with Expo Go (Android/iOS)
cd app && bun install && bunx expo install   # sync native deps
bunx expo start
```

## Pair the phone

1. Install **Expo Go** and join the same Tailscale tailnet.
2. Open Dash → **Pair with your laptop** (first launch) or **Chats → ⚙ Settings → Pair nearby (sonic)**.
3. Set **Computer name** to your laptop's Tailscale name (e.g. `host-a`), tap **Listen for pairing sound**.
4. Or enter **Address** + **Token** manually (Settings): `<tailscale-ip>:4747` and `~/.dash/token`.

**UI mock (no bridge):** `cd app && EXPO_PUBLIC_DEMO=1 bunx expo start`

**Debug mode (programmatic UI, no bridge):** `cd app && bun run debug` — or web + screenshots:

```bash
cd app && bun run debug:shots   # writes PNGs to screenshots/debug/
```

In debug mode, `window.__DASH_DEBUG__` exposes `scenario(id)`, `run({ action })`, and `state()`. Deep links: `dash://debug/scenario/chat-omp`.

**Static previews:** open `preview.html` in a browser. Pixel refs + storyboard: `docs/design/`.

## Chats filters and sorting

The middle **Chats** page has five compact controls:

- **Sessions** switches between All sessions and Active sessions. Active uses current host-scoped running or open sessions, plus phone turns in progress; saved history alone does not qualify.
- **Harness** filters by the session's agent, including non-catalog harnesses reported by the bridge.
- **Project** filters by the exact working folder. The picker shows full paths to distinguish folders with the same name.
- **Dates** filters by last activity. Today, the last 7 calendar days, and the last 30 calendar days start at local midnight.
- **Recent**, **Oldest**, and **Priority** choose the ordering. Priority puts chats needing attention first, then running chats, then other chats by recency, with ended chats last.

Filters combine. **Reset** clears the filters and restores Recent. Changing a filter or sort returns the list to the top. Stopping a turn counts as activity for Recent and date filtering.

With a `chats.v1` bridge, project discovery and global sorts load older pages while Chats is focused and online. The page shows **Searching history…** until the scan finishes. A date filter stops automatic and scroll-triggered paging at its lower bound, including while the project picker is open. Leaving Chats pauses automatic paging. Older bridges filter the conversations already available on the phone.

Live roster updates preserve your place in the list. After closing a full-screen chat, a single tap opens another chat; swiping between pages never opens a chat or sends a message.

## Next up

Chats shows one attention card from conversations already opened on this phone for the current connection, independently of the list filters. It names the chat and the action it needs. Pending approvals and failed sends come first, followed by unread replies, turns without recorded activity, and older drafts.

**Open** goes to that exact conversation. It never approves, retries, or sends anything. Each conversation keeps its own draft.

**Later** hides the current event for one hour in the app; it does not schedule a notification. **Skip** dismisses only that event, so a newer reply in the same chat can appear again. **Why?** explains the suggestion.

Seen replies and deferrals survive reloads within the current connection. Reading older history does not mark a newer reply seen, and clock changes cannot hide a new reply. First use and connection changes start a fresh baseline rather than presenting existing replies as new; unopened archives are not scanned for attention.

## Layout

| Path | Role |
|------|------|
| `app/` | Expo UI |
| `bridge/` | Bun WebSocket server + harness adapters |
| `shared/protocol.ts` | Wire format (both sides import this) |

See `AGENTS.md` for multi-agent ownership rules.

Triage includes running work from the canonical Hermes work board alongside
blockers and owner-needed priorities. “Running · board status” reports the
board's state, not independently verified process liveness. Source ages and
stale labels remain visible; resumed work does not reuse an old blocker reason.

Orchestra stops graph requests, Triage requests, and Triage age ticks when its
pane is hidden or the app leaves the foreground. Returning to the pane refreshes
the selected view. This preserves view selection across tab switches.
Leaving the pane invalidates its snapshots. On return, Triage waits for fresh
priorities and the graph labels its roster-only view until new evidence arrives.

Chat code blocks highlight JSX and TSX fences alongside the existing languages.
Source text and the existing syntax palette are preserved.

## Contributing / AI Agents

- **Contributing guide:** See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute (unattended compute donation vs copilot paired PR workflow).
- **Onboarding:** [docs/loop/ONBOARDING.md](docs/loop/ONBOARDING.md) — use vs contribute decision tree.
- **Issue priorities:** [docs/loop/ISSUE_PRIORITY.md](docs/loop/ISSUE_PRIORITY.md) — impact/effort rubric toward the mesh vision.
- **Agent skills:** `.cursor/skills/` — short `SKILL.md` files for agents working on this repo:
  - `autodevelop` — the whole contribution loop. Any harness: read this and start.
  - `tdd` — fail-then-pass + mutation. Use this for every behavior change.
  - `dash-onboard` — first-run for any agent (layout, ownership, conventions).
  - `dash-bridge` — bridge architecture and harness adapter patterns (read-only guidance).
  - `dash-debug` — pair → roster → WS hello/attach on :4747. Never paste tokens.
  - `dash-contribute` — PR hygiene, fail-then-pass proofs, community norms.
  - `dash-android-ui` / `dash-motion` — phone UI (only if the issue assigns UI work).
  - `verify-dash` — runtime proofs against the live bridge.

Pixel language: [docs/design/language.md](docs/design/language.md). Competitor + AODL + frontier-kb UI map: [docs/design/ai-ui-patterns/](docs/design/ai-ui-patterns/README.md).

## Harness notes

- **OMP** — `omp -p --mode json`
- **Codex** — `codex exec --json` (~30–120s cold start)
- **Grok** — `grok --output-format streaming-json`
- **Hermes** — `hermes chat -q` (slow; may warn on toolsets)
- **Claude Code** — shown unavailable until `claude` is on `PATH`
- **Pi** — `pi --mode json`; unavailable until `pi` is on `PATH`
- **fx** — native `fx acp` over stdio (Vercel Labs; not antonmedv/fx); unavailable until an ACP-capable `fx` is on `PATH`. No legacy `ask` fallback or permission-bypass flags.

Each harness keeps its own session id for multi-turn threads.

A phone-created ACP chat adopts the paired self host confirmed by its session
reply, so the native session id remains resumable after an executor exits or a
reconnect without a live roster row. This does not rebind an explicitly selected
host/profile or turn an ended native OMP process lease into a resumable chat.
For harnesses outside the native-history catalog, continuation requires the
existing matching generic harness profile on that exact self host.

### Saved history and endpoint ownership

Saved-local history with no endpoint provenance, or with another endpoint's
address, stays separate from the current endpoint's resumable native chat.
The same rule applies to an old session with no verified host binding. The
current native Chats list/search provides explicit recovery when the host
indexes that session. Otherwise start a new chat; do not guess its owner.
Opening a native result does not rebind the saved history or consume its draft.
Empty harness chats are reusable only by their owning current endpoint.
Phase polling, retained tool details and bound voice targets likewise retain
their endpoint provenance across switching.

An inactive chat's asynchronous cached transcript hydrates before a fresh native
history request. History loaders use per-loader ownership tokens so a stale
response cannot replace a newer page or clear another visit's loading flag.
Partial native user persistence preserves the phone-completed tail until native
catch-up. Native ids anchor ordering; ordered prompt/reply matching avoids
cross-clock duplicate turns and preserves richer multipart/cut/stopped replies.
Text-only native catch-up also retains phone attachments, tool cards and reply
disclosures with their original bridge turn owner. Older pages use observed
projection source ids to place rows before or after that retained phone turn.
Completed phone-only turns survive cache eviction, offline reload and unopened
roster updates without storing host-owned tool payloads.

A nonempty native refresh with a shared final source id can revoke a newer native
suffix. Empty history also means unavailable at the current bridge boundary, so
undo-to-empty cannot safely clear the display. A tool-round assistant anchor is
not final-text persistence attestation when the final save and its retry fail;
complete recovery from those two cases is not claimed.

See [Testing Dash](TESTING.md) for the browser and controlled consumer coverage.
Those tests are not S25/native-host qualification or proof of live MBP/Groot
connectivity, reconnect/session switching or native voice delivery.

The authenticated `GET /roster` also lists existing interactive OMP sessions on
Linux. It reads live `omp` processes and their open session JSONL handles under
`~/.omp/agent/sessions` (or `$PI_CODING_AGENT_DIR/sessions`); `TERN_PANE` supplies
the stable pane identity when available. Worker brokers and noninteractive
turns are not frontends, and nested subagent transcripts are not separate chats.
If process inspection is unavailable, broker discovery remains the fallback.
Both current `--absolute-cwd--` and older single-dash session folders are read.
An unreadable frontend handle is listed without guessing another session's ID.

`DASH_REMOTE_HOSTS="mbp=ssh-alias"` enables recorded Claude Code and Codex
sessions on that machine. Remote machine IDs preserve the full accepted name
(up to 64 characters), so names with identical first 56 characters stay distinct.
This setting does not add remote routes for other harnesses.

Canonical ids: [kvnloo/aodl `harnesses/catalog.json`](https://github.com/kvnloo/aodl/blob/main/harnesses/catalog.json). `o8` is a control room; firstmate is a distro — neither is a Dash spawn target.

## Related

- IR: [kvnloo/aodl](https://github.com/kvnloo/aodl)
- Research: [kvnloo/frontier-kb](https://github.com/kvnloo/frontier-kb)
- Hermes governance: [kvnloo/hermes-keel](https://github.com/kvnloo/hermes-keel)
