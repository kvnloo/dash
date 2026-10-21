/**
 * One Dash reply into a Hermes session that is live in a gateway-hosted CLI/TUI, sent the way
 * Hermes's own clients send it: `hermes chat --resume <id> --query-file - --format stream-json`.
 *
 * In current Hermes that command is a thin gateway client (`hermes_cli/gateway_chat.py`): it
 * attaches to the profile's running gateway as one more viewer (`session.resume`), admits the
 * text with `prompt.submit` on the session's durable FIFO and follows only ITS admission. So an
 * idle session runs it as the next turn, a running turn gets it queued behind it, the open
 * TUI paints the turn, and other viewers' turns never leak into Dash's reply (the gateway ACP
 * projection forwards every viewer's deltas, so it is not used for this). It never takes the
 * terminal's session lease and never runs an agent of its own.
 *
 * Only used when `ownerHosting` proved a gateway serves the session; a standalone owner still
 * gets the ordered handoff. The text goes on stdin, not argv.
 */
import { TurnPhase } from "./turn-phase";

export type LiveSink = { delta(text: string): void; status(text: string): void };
export type LiveResult = { text: string; sessionId: string; exitCode: number };

export type LiveEvent =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; id?: string }
  | { kind: "tool-done"; name?: string; id?: string }
  | { kind: "thinking" }
  | { kind: "waiting" }
  | { kind: "result"; exitCode: number; text: string; sessionId?: string; error?: string; replayGap?: boolean }
  | { kind: "other" };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function liveArgv(bin: string, sessionId: string): string[] {
  return [bin, "chat", "--resume", sessionId, "--query-file", "-", "--format", "stream-json"];
}

/** One stdout line of Hermes's stream-json protocol (`hermes_cli/stream_json.py`). */
export function parseLiveLine(line: string): LiveEvent {
  let value: unknown;
  try { value = JSON.parse(line); } catch { return { kind: "other" }; }
  if (!record(value)) return { kind: "other" };
  switch (value.type) {
    case "text": return typeof value.text === "string" ? { kind: "text", text: value.text } : { kind: "other" };
    case "reasoning":
    case "thinking": return { kind: "thinking" };
    case "approval.request":
    case "clarification.request": return { kind: "waiting" };
    case "tool_use": return { kind: "tool", name: typeof value.name === "string" && value.name ? value.name : "a_tool", ...(typeof value.tool_call_id === "string" ? { id: value.tool_call_id } : {}) };
    case "tool_result": return { kind: "tool-done", ...(typeof value.name === "string" ? { name: value.name } : {}), ...(typeof value.tool_call_id === "string" ? { id: value.tool_call_id } : {}) };
    case "result": {
      const exitCode = typeof value.exit_code === "number" ? value.exit_code : 1;
      const error = typeof value.error === "string" ? value.error : undefined;
      return { kind: "result", exitCode, text: typeof value.text === "string" ? value.text : "", ...(typeof value.session_id === "string" && value.session_id ? { sessionId: value.session_id } : {}), ...(error ? { error } : {}), ...(value.replay_gap === true ? { replayGap: true } : {}) };
    }
    default: return { kind: "other" };
  }
}

export type LiveSpawn = (argv: string[], options: { cwd?: string; env: Record<string, string | undefined> }) => {
  stdin: { write(text: string): unknown; end(): unknown };
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(signal?: NodeJS.Signals | number): void;
};

const bunSpawn: LiveSpawn = (argv, options) => {
  const child = Bun.spawn(argv, { cwd: options.cwd, env: options.env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  return { stdin: { write: text => child.stdin.write(text), end: () => child.stdin.end() }, stdout: child.stdout, stderr: child.stderr, exited: child.exited, kill: signal => child.kill(signal) };
};

async function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) { onLine(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
  }
  if (buffer.trim()) onLine(buffer);
}

export async function sendIntoLiveSession(options: {
  argv: string[];
  home: string;
  sessionId: string;
  text: string;
  sink: LiveSink;
  cwd?: string;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
  spawn?: LiveSpawn;
}): Promise<LiveResult> {
  // The profile's own gateway, discovered from HERMES_HOME. Never an inherited explicit remote URL.
  const env: Record<string, string | undefined> = { ...(options.env ?? process.env), HERMES_HOME: options.home };
  delete env.HERMES_TUI_GATEWAY_URL;
  const child = (options.spawn ?? bunSpawn)(options.argv, { cwd: options.cwd, env });
  child.stdin.write(options.text);
  child.stdin.end();
  const phase = new TurnPhase(text => options.sink.status(text));
  phase.thinking();
  let streamed = "";
  let result: Extract<LiveEvent, { kind: "result" }> | undefined;
  let stderrTail = "";
  let terminateTimer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => {
    // Ctrl-C: the thin client withdraws its own still-queued admission; a running turn is the gateway's.
    child.kill("SIGINT");
    terminateTimer = setTimeout(() => child.kill("SIGTERM"), 5_000);
    terminateTimer.unref?.();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await Promise.all([
      readLines(child.stdout, line => {
        const event = parseLiveLine(line);
        if (event.kind === "text") { if (event.text) { phase.text(); streamed += event.text; options.sink.delta(event.text); } }
        else if (event.kind === "tool") phase.start(event.name, event.id);
        else if (event.kind === "tool-done") phase.complete(event.id, event.name);
        else if (event.kind === "thinking") phase.thinking();
        else if (event.kind === "waiting") phase.waiting();
        else if (event.kind === "result") result = event;
      }),
      readLines(child.stderr, line => { if (line.trim()) stderrTail = line.trim().slice(0, 240); }),
    ]);
    const code = await child.exited;
    if (options.signal?.aborted) throw new Error("Cancelled. A turn the gateway already started keeps running in the open session.");
    if (!result) throw new Error(`Hermes gateway client ended without a result (exit ${code}). The reply may still land in the open session; check it before resending.`);
    if (result.exitCode !== 0) throw new Error(`Hermes: ${result.error ?? (stderrTail.replace(/^Error:\s*/, "") || `exit ${result.exitCode}`)}`);
    // Unstreamed, or cut by a replay gap (`text` events stopped; `text` is the whole reply): show the rest once.
    if (!streamed.trim() && result.text) { options.sink.delta(result.text); streamed = result.text; }
    else if (result.replayGap && result.text.startsWith(streamed) && result.text.length > streamed.length) { options.sink.delta(result.text.slice(streamed.length)); streamed = result.text; }
    const text = streamed;
    if (!text.trim()) throw new Error("Hermes finished without a reply.");
    return { text, sessionId: result.sessionId ?? options.sessionId, exitCode: 0 };
  } finally {
    clearTimeout(terminateTimer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
