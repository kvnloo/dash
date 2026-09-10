# Dash Bridge

**When to use:** Working on the WebSocket bridge, protocol changes, or harness adapters. Read this skill for architecture guidance and patterns (read-only; do not edit bridge code unless you own the bridge session).

## What is the Bridge?

The bridge is a Bun WebSocket server that:

1. Listens on your Tailscale network at port `4747` (override with `DASH_PORT`).
2. Accepts connections from the Dash phone app.
3. Spawns agent CLIs (omp, codex, grok, claude, hermes, pi, fx) as subprocesses.
4. Parses their stdout (JSON, NDJSON, or plain text) and streams events to the phone.
5. Manages multi-turn sessions (each harness has its own session ID for resuming conversations).
6. Handles reconnects (phone locks screen → WebSocket drops → phone unlocks → reattach with last seen event sequence).

**Entry point:** `bridge/index.ts`

**Harness adapters:** `bridge/src/harnesses.ts`. `bridge/index.ts` imports `HARNESSES` from there.

**Protocol:** `shared/protocol.ts` (dependency-free; imported by both bridge and app)

## Protocol Overview (shared/protocol.ts)

**Client → Server (phone → bridge):**

- `{ type: "chat", id: string, harness: string, text: string, sessionId?: string, cwd?: string }`  
  Start a new turn. `id` is client-chosen (UUID). `sessionId` resumes a multi-turn conversation. `cwd` overrides the default working directory.

- `{ type: "cancel", id: string }`  
  Send SIGTERM to the running process (followed by SIGKILL after 3s if it doesn't exit).

- `{ type: "attach", turns: [{ id: string, seq: number }] }`  
  Re-subscribe to turns that were in flight when the socket dropped. `seq` is the last event sequence the client saw; the bridge replays everything after it.

**Server → Client (bridge → phone):**

- `{ type: "hello", version: number, host: string, cwd: string, harnesses: HarnessInfo[] }`  
  Sent immediately on WebSocket open. Lists available harnesses (id, name, available boolean).

- `{ type: "session", id: string, seq: number, sessionId: string }`  
  The harness created a session ID. The client can pass this back as `sessionId` to resume the conversation.

- `{ type: "delta", id: string, seq: number, text: string }`  
  Streaming text from the agent (batched at 40ms intervals to avoid flooding).

- `{ type: "status", id: string, seq: number, text: string }`  
  Short status line (e.g., "Editing files", "$ npm install"). Empty string clears the status.

- `{ type: "error", id: string, seq: number, message: string }`  
  An error occurred (harness not installed, non-zero exit, parse failure).

- `{ type: "done", id: string, seq: number, exitCode: number }`  
  The process exited. Finished turns are retained for 10 minutes to support late reattaches.

- `{ type: "lost", id: string }`  
  Reply to `attach` for a turn the bridge no longer knows about (pruned after 10 min).

**Sequence numbers (`seq`):** Per-turn, strictly increasing from 1. The client uses `seq` to request replays after reconnecting.

## Harness Adapter Pattern

Each harness implements:

```typescript
interface Harness {
  id: string;           // "omp", "codex", "grok", "claude", "hermes", "pi", "fx"
  name: string;         // "OMP", "Codex", "Grok", "Claude Code", "Hermes", "Pi", "fx"
  bin: string;          // CLI command (checked with Bun.which)
  argv(input: TurnInput): string[];  // Build CLI args (includes resume, cwd, text)
  parser(sink: Sink): LineParser;     // Parse stdout and call sink methods
}

interface Sink {
  session(sessionId: string): void;  // Emit a session event
  delta(text: string): void;          // Emit a text delta (batched)
  status(text: string): void;         // Emit a status line (empty = clear)
  error(message: string): void;       // Emit an error
}

interface LineParser {
  line(line: string): void;  // Called for each line of stdout (no trailing newline)
  end(): void;                // Called when process exits (flush buffered state)
}
```

**Example (OMP):**

- CLI: `omp -p --mode json --auto-approve --allow-home --cwd <cwd> [--resume <session>] <text>`
- Output: One JSON event per line (NDJSON).
- Parser: `JSON.parse` each line, switch on `type`.

**Example (Hermes):**

- CLI: `hermes chat -q <text> -Q --in <cwd> [--resume <session>]`
- Output: Plain text prose, then `session_id: <id>` at the end.
- Parser: Buffer lines, extract session ID with regex, emit prose on `end()`.

**Example (Grok, Claude Code):**

- CLI: `grok -p <text> --output-format streaming-messages-json ...` (similar for `claude`)
- Output: Anthropic Messages API format over NDJSON.
- Parser: Shared `anthropicStreamParser` (handles `content_block_delta`, `tool_use`, etc.).

**Example (Pi):**

- CLI: `pi --mode json --approve [--session <id>] -- <text>`
- Output: Same NDJSON session/text_delta stream as OMP.
- Parser: Shared `sessionNdjsonParser`.

**Example (fx):**

- CLI: `fx ask --json --full-access [--resume-id <id>] -- <text>`
- Output: One JSON object (`session_id`, `output`, `final_output`).
- Parser: Buffer stdout and emit on `end()`.

1. Define a `Harness` object with `id`, `name`, `bin`, `argv`, and `parser`.
2. Add it to the `HARNESSES` array in `bridge/src/harnesses.ts` (live `dash-pair` imports that list).
3. Test with a real agent CLI (check `Bun.which(bin)` to see if it's installed).
4. Open a PR with an example conversation log and a note about session resume support.

## Key Implementation Details

**Turn lifecycle:**

1. Client sends `{ type: "chat", ... }`.
2. Bridge spawns `Bun.spawn([bin, ...argv])`, pipes stdout/stderr.
3. Parser reads stdout line-by-line, calls sink methods (`delta`, `status`, `session`, `error`).
4. Process exits → parser calls `end()` → bridge emits `{ type: "done", exitCode }`.
5. Turn is retained for 10 minutes, then pruned (max 50 retained turns).

**Reconnect (attach):**

1. Client drops socket (phone screen locks, network change, etc.).
2. Client reconnects, sends `{ type: "attach", turns: [{ id, seq }] }`.
3. Bridge replays all events with `seq > lastSeenSeq` for each turn.
4. If turn was pruned, bridge sends `{ type: "lost", id }`.

**Batching deltas:**

- Parser calls `sink.delta(text)` for each chunk.
- Sink buffers text and flushes every 40ms (configurable `FLUSH_MS`).
- This prevents hundreds of tiny WebSocket frames per second for fast models.

**Status lines:**

- Parsers call `sink.status(text)` when a tool starts (e.g., "Editing files", "$ npm install").
- Call `sink.status("")` (empty string) to clear the status when the tool finishes.
- Status is extracted from tool names and arguments (see `describeTool` in `bridge/src/harnesses.ts`).

**Error handling:**

- Non-zero exit codes trigger `sink.error(stderrTail)` (last 2KB of stderr).
- Parse failures are logged but don't crash the turn (graceful degradation).
- Cancelled turns (via `{ type: "cancel" }`) emit `{ type: "done", exitCode: 130 }` (SIGTERM exit code).

## Protocol Changes

If you need to change `shared/protocol.ts`:

1. **Add new fields** instead of removing old ones (backward compatibility).
2. **Parse with optional checks** (e.g., `optStr(raw.newField)`).
3. **Test with both old and new clients** (phone may lag behind bridge updates).
4. **Update `PROTOCOL_VERSION`** if the change is breaking (server rejects old clients).

See [AGENTS.md](../../AGENTS.md) for ownership: `bridge/**` and `shared/protocol.ts` are owned by the bridge session.

## Testing

**Manual test:**

1. Start the bridge: `cd bridge && bun run index.ts`
2. Connect with `wscat`: `wscat -c 'ws://localhost:4747/ws?token=<token>'`
3. Send: `{"type":"chat","id":"test-1","harness":"omp","text":"list files"}`
4. Observe: `hello`, `session`, `status`, `delta`, `done` events.

**Automated tests:** `bridge/src/harnesses.test.ts` pins argv and stdout parsers. Run `bun test app/src bridge/src shared`.

## Questions?

Open a discussion or issue in the repo. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for details.
