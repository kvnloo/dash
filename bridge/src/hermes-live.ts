/**
 * One Dash reply into a gateway-hosted Hermes session. The bridge-owned Python helper uses
 * Hermes's GatewayChatView one-shot follow path and StreamJsonEmitter, but removes `finite`
 * from prompt.submit. The viewer follows one admission; the long-lived chat stays attended.
 *
 * Hermes retains admission filtering, control detachment and replay-gap recovery. Async
 * delegates and background completions remain available. This never takes the terminal's
 * session lease, starts a gateway, or runs an agent of its own.
 *
 * Only used when `ownerHosting` proved a gateway serves the session; a standalone owner still
 * gets the ordered handoff. The text goes on stdin, not argv.
 */
import { fileURLToPath } from "node:url";
import { PartEmitter, hermesParts } from "./reply-parts";
import type { ReplyPart } from "../../shared/protocol";
import { TurnPhase } from "./turn-phase";

export type LiveSink = { part?(part: ReplyPart): void; delta(text: string): void; status(text: string): void };
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
  return ["python3", fileURLToPath(new URL("./hermes-live.py", import.meta.url)), "--hermes-bin", bin, "--session-id", sessionId];
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
  onStarted?(): void;
}): Promise<LiveResult> {
  // The profile's own gateway, discovered from HERMES_HOME. Never an inherited explicit remote URL.
  const env: Record<string, string | undefined> = { ...(options.env ?? process.env), HERMES_HOME: options.home };
  delete env.HERMES_TUI_GATEWAY_URL;
  const child = (options.spawn ?? bunSpawn)(options.argv, { cwd: options.cwd, env });
  child.stdin.write(options.text);
  child.stdin.end();
  const phase = new TurnPhase(text => options.sink.status(text));
  phase.thinking();
  const parts = new PartEmitter(part => options.sink.part?.(part));
  let streamed = "";
  let result: Extract<LiveEvent, { kind: "result" }> | undefined;
  let stderrTail = "";
  let terminateTimer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => {
    // Detach this viewer only. Accepted queued/running work remains owned by the gateway.
    child.kill("SIGINT");
    terminateTimer = setTimeout(() => child.kill("SIGTERM"), 5_000);
    terminateTimer.unref?.();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await Promise.all([
      readLines(child.stdout, line => {
        try { hermesParts(JSON.parse(line), parts); } catch { /* non-JSON diagnostics */ }
        const event = parseLiveLine(line);
        if (event.kind !== "other" && (event.kind !== "result" || event.text)) options.onStarted?.();
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
    if (result.exitCode !== 0) {
      const error = result.error ?? (stderrTail.replace(/^Error:\s*/, "") || `exit ${result.exitCode}`);
      if (result.exitCode === 3 && error.startsWith("Input required")) throw new Error("Hermes needs an answer in its TUI/CLI. Dash detached without cancelling the turn. Answer the pending clarification or approval there; do not resend this message.");
      throw new Error(`Hermes: ${error}`);
    }
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
