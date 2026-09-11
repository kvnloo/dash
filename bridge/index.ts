// Dash bridge: a WebSocket server on your tailnet that runs agent CLIs on this
// machine and streams their output to the phone.
//
//   bun bridge/index.ts
//
// Env: DASH_PORT (4747), DASH_HOST (defaults to all interfaces so LAN + Tailscale both work), DASH_CWD (launch dir).
//
// Turns outlive sockets. A phone that locks its screen drops the WebSocket; on
// reconnect it sends `attach` with the last seq it saw and the bridge replays
// the rest. Finished turns are kept for RETAIN_MS so late reattaches still work.

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import {
  PROTOCOL_VERSION,
  parseClientMessage,
  type HarnessInfo,
  type ServerMessage,
  type TurnEvent,
} from "../shared/protocol";
import { CLAIM_KEY_BYTES, claimSession, currentOrCreateSession, startBoundSession } from "./pair";
import { playPairCode } from "./pair-audio";
import { decodePairAudio } from "./pair-decode";
import { collectRoster, readLiveTranscript } from "./src/roster";
import { hermesCliArgv, runHermesSession } from "./src/hermes-session";
import {
  CANCELLED_EXIT_CODE,
  TIMEOUT_EXIT_CODE,
  nonZeroExitMessage,
  parseHarnessJsonLine,
  replayAfter,
  timeoutMessage,
  turnTimeoutMs,
  waitForExitOrTimeout,
} from "./src/turn-safety";
import { speechAvailable, transcribe, warmup } from "./speech";

// ---------------------------------------------------------------------------
// Harness adapters
// ---------------------------------------------------------------------------

interface TurnInput {
  text: string;
  cwd: string;
  sessionId?: string;
}

interface Sink {
  session(sessionId: string): void;
  delta(text: string): void;
  /** Short line describing what the agent is doing right now. Empty string clears it. */
  status(text: string): void;
  error(message: string): void;
}

interface LineParser {
  /** One line of stdout, without the trailing newline. */
  line(line: string): void;
  /** Process exited; flush anything still buffered. */
  end(): void;
}

interface Harness {
  id: string;
  name: string;
  bin: string;
  argv(input: TurnInput): string[];
  parser(sink: Sink): LineParser;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): value is string {
  return typeof value === "string";
}

function parseJsonLine(line: string, sink?: Sink): Record<string, unknown> | null {
  const parsed = parseHarnessJsonLine(line);
  if (!parsed) return null;
  if (!parsed.ok) {
    sink?.error(parsed.error);
    return null;
  }
  return parsed.value;
}

const STATUS_MAX = 100;

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > STATUS_MAX ? `${flat.slice(0, STATUS_MAX - 1)}…` : flat;
}

/** Turn a tool call into a short human-readable status line. */
function describeTool(name: string, args: unknown): string {
  if (isRecord(args)) {
    if (str(args.command)) return oneLine(`$ ${args.command}`);
    for (const key of ["path", "file_path", "filePath", "file", "pattern", "query", "url"]) {
      const value = args[key];
      if (str(value)) return oneLine(`${name} ${value}`);
    }
  }
  return oneLine(name);
}

const noopEnd = (): void => {};

// omp: `--mode json` streams one event per line.
const omp: Harness = {
  id: "omp",
  name: "OMP",
  bin: "omp",
  argv({ text, cwd, sessionId }) {
    return [
      "-p",
      "--mode",
      "json",
      "--auto-approve",
      "--allow-home",
      "--cwd",
      cwd,
      ...(sessionId ? ["--resume", sessionId] : []),
      text,
    ];
  },
  parser(sink) {
    return {
      line(line) {
        const ev = parseJsonLine(line, sink);
        if (!ev) return;
        switch (ev.type) {
          case "session":
            if (str(ev.id)) sink.session(ev.id);
            break;
          case "message_update": {
            const e = ev.assistantMessageEvent;
            if (isRecord(e) && e.type === "text_delta" && str(e.delta)) sink.delta(e.delta);
            break;
          }
          case "tool_execution_start":
            if (str(ev.toolName)) sink.status(describeTool(ev.toolName, ev.args));
            break;
          case "tool_execution_end":
            sink.status("");
            break;
        }
      },
      end: noopEnd,
    };
  },
};

// codex: `exec --json` emits thread/turn/item events. Messages arrive whole, not as deltas.
const codex: Harness = {
  id: "codex",
  name: "Codex",
  bin: "codex",
  argv({ text, cwd, sessionId }) {
    return sessionId
      ? ["exec", "resume", "--json", "--skip-git-repo-check", sessionId, text]
      : ["exec", "--json", "--skip-git-repo-check", "-C", cwd, "-s", "workspace-write", text];
  },
  parser(sink) {
    let emitted = false;
    return {
      line(line) {
        const ev = parseJsonLine(line, sink);
        if (!ev) return;
        if (ev.type === "thread.started" && str(ev.thread_id)) {
          sink.session(ev.thread_id);
          return;
        }
        const item = ev.item;
        if (!isRecord(item)) return;
        if (ev.type === "item.started" || ev.type === "item.updated") {
          switch (item.type) {
            case "command_execution":
              if (str(item.command)) sink.status(oneLine(`$ ${item.command}`));
              break;
            case "reasoning":
              sink.status("Thinking");
              break;
            case "file_change":
              sink.status("Editing files");
              break;
            case "web_search":
              sink.status("Searching the web");
              break;
          }
        } else if (ev.type === "item.completed") {
          if (item.type === "agent_message" && str(item.text)) {
            sink.delta(emitted ? `\n\n${item.text}` : item.text);
            emitted = true;
          }
          sink.status("");
        }
      },
      end: noopEnd,
    };
  },
};

// grok and claude both speak the Anthropic Messages wire format over NDJSON.
function anthropicStreamParser(sink: Sink): LineParser {
  let sawDelta = false;
  return {
    line(line) {
      const ev = parseJsonLine(line, sink);
      if (!ev) return;
      switch (ev.type) {
        case "system":
          if (ev.subtype === "init" && str(ev.session_id)) sink.session(ev.session_id);
          break;
        case "stream_event": {
          const e = ev.event;
          if (!isRecord(e)) return;
          if (e.type === "content_block_delta") {
            const d = e.delta;
            if (isRecord(d) && d.type === "text_delta" && str(d.text)) {
              sawDelta = true;
              sink.delta(d.text);
            }
          } else if (e.type === "content_block_start") {
            const b = e.content_block;
            if (isRecord(b) && b.type === "tool_use" && str(b.name)) sink.status(oneLine(b.name));
          }
          break;
        }
        case "assistant": {
          const m = ev.message;
          if (!isRecord(m) || !Array.isArray(m.content)) return;
          for (const block of m.content) {
            if (!isRecord(block)) continue;
            if (block.type === "tool_use" && str(block.name)) {
              sink.status(describeTool(block.name, block.input));
            } else if (block.type === "text" && str(block.text) && !sawDelta) {
              // CLI built without partial-message support: fall back to whole messages.
              sink.delta(block.text);
            }
          }
          break;
        }
        case "user":
          // Tool results come back as user messages; the tool is finished.
          sink.status("");
          break;
        case "result":
          if (ev.is_error === true) {
            sink.error(str(ev.result) ? ev.result : "The agent reported an error.");
          }
          break;
      }
    },
    end: noopEnd,
  };
}

const grok: Harness = {
  id: "grok",
  name: "Grok",
  bin: "grok",
  argv({ text, cwd, sessionId }) {
    return [
      "-p",
      text,
      "--output-format",
      "streaming-messages-json",
      "--include-partial-messages",
      "--always-approve",
      "--cwd",
      cwd,
      ...(sessionId ? ["--resume", sessionId] : []),
    ];
  },
  parser: anthropicStreamParser,
};

const claude: Harness = {
  id: "claude",
  name: "Claude Code",
  bin: "claude",
  argv({ text, sessionId }) {
    return [
      "-p",
      text,
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode",
      "bypassPermissions",
      ...(sessionId ? ["--resume", sessionId] : []),
    ];
  },
  parser: anthropicStreamParser,
};

// hermes: quiet mode prints the final answer, then `session_id: <id>`. No streaming.
const HERMES_NOISE = /^(Warning:|⚠|\s{2}\S.*(gateway|hermes update))/i;

const hermes: Harness = {
  id: "hermes",
  name: "Hermes",
  bin: "hermes",
  argv: hermesCliArgv,
  parser(sink) {
    const lines: string[] = [];
    return {
      line(line) {
        const match = /^session_id:\s*(\S+)\s*$/.exec(line);
        if (match?.[1]) {
          sink.session(match[1]);
          return;
        }
        if (HERMES_NOISE.test(line)) return;
        lines.push(line);
      },
      end() {
        const text = lines.join("\n").trim();
        if (text) sink.delta(text);
      },
    };
  },
};

const HARNESSES: readonly Harness[] = [omp, codex, grok, claude, hermes];

// ---------------------------------------------------------------------------
// Turns: one spawned process, a replayable event log, and a set of listeners
// ---------------------------------------------------------------------------

type Socket = Bun.ServerWebSocket<SocketData>;

interface SocketData {
  /** Turn ids this socket is subscribed to. */
  turns: Set<string>;
}

/** Batches text deltas so a fast model doesn't turn into hundreds of tiny frames per second. */
const FLUSH_MS = 40;
const STDERR_TAIL = 2000;
/** How long a finished turn stays replayable. */
const RETAIN_MS = 10 * 60 * 1000;
const MAX_RETAINED = 50;

class Turn implements Sink {
  readonly events: TurnEvent[] = [];
  readonly listeners = new Set<Socket>();
  finished = false;

  private buffer = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cancelled = false;
  private proc: Bun.Subprocess<"ignore", "pipe", "pipe"> | null = null;
  private abort: AbortController | null = null;
  /** Last two characters of text sent so far; used to separate prose around tool calls. */
  private textTail = "";
  private breakPending = false;

  constructor(
    readonly id: string,
    readonly harness: Harness,
  ) {}

  start(input: TurnInput): void {
    // A spoken turn is transcribed before it starts, so a cancel can arrive
    // while there is no process to kill yet.
    if (this.cancelled || this.finished) return;
    if (this.harness.id === "hermes") {
      this.startHermes(input);
      return;
    }
    this.spawnCli(input);
  }

  private startHermes(input: TurnInput): void {
    const abort = new AbortController();
    this.abort = abort;
    log("turn.start", {
      id: this.id,
      harness: "hermes",
      cwd: input.cwd,
      resume: Boolean(input.sessionId),
    });
    void (async () => {
      try {
        const result = await runHermesSession({
          input,
          env: process.env,
          log,
          signal: abort.signal,
        });
        if (this.cancelled) {
          if (!this.finished) this.finish(CANCELLED_EXIT_CODE);
          return;
        }
        if (this.finished) return;
        if (result.path === "cli") {
          this.spawnCli(input);
          return;
        }
        if (result.sessionId) this.session(result.sessionId);
        if (result.text) this.delta(result.text);
        this.finish(0);
        log("turn.end", { id: this.id, harness: "hermes", exitCode: 0, path: result.path });
      } catch (error) {
        if (this.cancelled) {
          if (!this.finished) this.finish(CANCELLED_EXIT_CODE);
          return;
        }
        if (this.finished) return;
        this.error(String(error));
        this.finish(1);
      }
    })();
  }

  private spawnCli(input: TurnInput): void {
    if (this.cancelled || this.finished) return;
    const parser = this.harness.parser(this);
    const proc = Bun.spawn([this.harness.bin, ...this.harness.argv(input)], {
      cwd: input.cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", TERM: "dumb" },
    });
    this.proc = proc;
    log("turn.start", {
      id: this.id,
      harness: this.harness.id,
      pid: proc.pid,
      cwd: input.cwd,
      resume: Boolean(input.sessionId),
    });

    let stderrTail = "";
    const stdoutDone = readLines(proc.stdout, (line) => {
      try {
        parser.line(line);
      } catch (error) {
        log("turn.parse_error", { id: this.id, error: String(error) });
      }
    });
    const stderrDone = readLines(proc.stderr, (line) => {
      stderrTail = `${stderrTail}${line}\n`.slice(-STDERR_TAIL);
    });

    void (async () => {
      const timeoutMs = turnTimeoutMs();
      const { exitCode, timedOut } = await waitForExitOrTimeout(proc, timeoutMs);
      await Promise.all([stdoutDone, stderrDone]);
      parser.end();
      if (this.cancelled) {
        this.finish(CANCELLED_EXIT_CODE);
      } else if (timedOut) {
        this.error(timeoutMessage(this.harness.name, timeoutMs));
        this.finish(TIMEOUT_EXIT_CODE);
      } else {
        if (exitCode !== 0) {
          this.error(nonZeroExitMessage(this.harness.name, exitCode, stderrTail));
        }
        this.finish(exitCode);
      }
      log("turn.end", { id: this.id, harness: this.harness.id, exitCode, cancelled: this.cancelled, timedOut });
    })();
  }

  cancel(): void {
    if (this.cancelled || this.finished) return;
    this.cancelled = true;
    this.abort?.abort();
    if (!this.proc) {
      this.finish(CANCELLED_EXIT_CODE);
      return;
    }
    const proc = this.proc;
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (proc.exitCode === null) proc.kill("SIGKILL");
    }, 3000);
  }

  /** Send every event after `afterSeq` to one socket. */
  replay(ws: Socket, afterSeq: number): void {
    for (const event of replayAfter(this.events, afterSeq)) sendTo(ws, event);
  }

  // Sink -------------------------------------------------------------------

  session(sessionId: string): void {
    this.flush();
    this.emit({ type: "session", id: this.id, seq: 0, sessionId });
  }

  /** What we heard, for a turn the user spoke rather than typed. */
  transcript(text: string): void {
    this.emit({ type: "transcript", id: this.id, seq: 0, text });
  }

  /** End a turn that never spawned: transcription failed, or heard nothing. */
  endWithout(message?: string): void {
    if (this.finished) return;
    if (message) this.error(message);
    this.finish(message ? 1 : 0);
  }

  delta(text: string): void {
    if (!text) return;
    if (this.breakPending) {
      // Prose resumed after a tool call. Models rarely emit the separator themselves.
      this.breakPending = false;
      if (!this.textTail.endsWith("\n") && !text.startsWith("\n")) text = `\n\n${text.trimStart()}`;
    }
    this.buffer += text;
    this.textTail = (this.textTail + text).slice(-2);
    if (this.timer === null) this.timer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  status(text: string): void {
    this.flush();
    if (text && this.textTail) this.breakPending = true;
    this.emit({ type: "status", id: this.id, seq: 0, text });
  }

  error(message: string): void {
    this.flush();
    this.emit({ type: "error", id: this.id, seq: 0, message });
  }

  private finish(exitCode: number): void {
    this.flush();
    this.finished = true;
    this.emit({ type: "done", id: this.id, seq: 0, exitCode });
    setTimeout(() => turns.delete(this.id), RETAIN_MS);
    pruneTurns();
  }

  private flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer) {
      const text = this.buffer;
      this.buffer = "";
      this.emit({ type: "delta", id: this.id, seq: 0, text });
    }
  }

  private emit(event: TurnEvent): void {
    event.seq = this.events.length + 1;
    this.events.push(event);
    for (const ws of this.listeners) sendTo(ws, event);
  }
}

const turns = new Map<string, Turn>();

function pruneTurns(): void {
  if (turns.size <= MAX_RETAINED) return;
  for (const [id, turn] of turns) {
    if (turns.size <= MAX_RETAINED) break;
    if (turn.finished) turns.delete(id);
  }
}

async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let rest = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    rest += decoder.decode(value, { stream: true });
    let newline = rest.indexOf("\n");
    while (newline >= 0) {
      onLine(rest.slice(0, newline).replace(/\r$/, ""));
      rest = rest.slice(newline + 1);
      newline = rest.indexOf("\n");
    }
  }
  rest += decoder.decode();
  if (rest) onLine(rest);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const PORT = Number(process.env.DASH_PORT ?? "4747");
const DEFAULT_CWD = process.env.DASH_CWD ?? process.cwd();
const HOST_NAME = hostname();

function loadToken(): string {
  const directory = join(process.env.HOME ?? ".", ".dash");
  const path = join(directory, "token");
  try {
    const existing = readFileSync(path, "utf8").trim();
    if (existing.length >= 16) return existing;
  } catch {
    // first run
  }
  mkdirSync(directory, { recursive: true });
  const token = crypto.randomUUID().replaceAll("-", "");
  writeFileSync(path, token, { mode: 0o600 });
  return token;
}

function log(event: string, fields: Record<string, unknown> = {}): void {
  const time = new Date().toISOString().slice(11, 19);
  const detail = Object.entries(fields)
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" ");
  process.stderr.write(`${time} ${event} ${detail}\n`);
}

function tailscaleIPv4(): string | null {
  try {
    const result = Bun.spawnSync(["tailscale", "ip", "-4"], { stdout: "pipe", stderr: "ignore" });
    if (result.exitCode !== 0) return null;
    const ip = result.stdout.toString().split("\n").find((line) => line.startsWith("100."));
    return ip ?? null;
  } catch {
    return null;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function harnessList(): HarnessInfo[] {
  return HARNESSES.map((h) => ({ id: h.id, name: h.name, available: Bun.which(h.bin) !== null }));
}

function parseJson(raw: string | Buffer): unknown {
  try {
    return JSON.parse(typeof raw === "string" ? raw : raw.toString());
  } catch {
    return null;
  }
}

function sendTo(ws: Socket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

/** A turn that failed before its process could start still needs a well-formed event stream. */
function rejectTurn(ws: Socket, id: string, message: string): void {
  sendTo(ws, { type: "error", id, seq: 1, message });
  sendTo(ws, { type: "done", id, seq: 2, exitCode: 1 });
}

// ---------------------------------------------------------------------------
// Spoken turns
// ---------------------------------------------------------------------------

/** Audio for a turn the phone is still streaming, before it has been transcribed. */
interface Utterance {
  chunks: Uint8Array[];
  bytes: number;
  cwd: string;
  sessionId?: string;
  startedAt: number;
}

/** Utterances are seconds long; this only catches a runaway recorder. */
const MAX_UTTERANCE_BYTES = 4 * 1024 * 1024;

const utterances = new Map<string, Utterance>();

async function runVoiceTurn(turn: Turn, utterance: Utterance): Promise<void> {
  const audio = Buffer.concat(utterance.chunks);
  const uploadMs = Date.now() - utterance.startedAt;
  turn.status("Transcribing…");
  try {
    const heard = await transcribe(new Uint8Array(audio), turn.id);
    log("voice.heard", {
      id: turn.id,
      bytes: audio.byteLength,
      uploadMs,
      audioSec: Number(heard.audioSeconds.toFixed(2)),
      transcodeMs: heard.transcodeMs,
      sttMs: heard.sttMs,
      rtf: Number((heard.sttMs / 1000 / Math.max(heard.audioSeconds, 0.01)).toFixed(2)),
      chars: heard.text.length,
    });
    if (!heard.text) {
      // Silence or background noise. End quietly instead of showing an error;
      // in hands-free use this happens all the time.
      turn.endWithout();
      return;
    }
    turn.transcript(heard.text);
    turn.start({ text: heard.text, cwd: utterance.cwd, sessionId: utterance.sessionId });
  } catch (error) {
    log("voice.failed", { id: turn.id, error: String(error) });
    turn.endWithout(error instanceof Error ? error.message : String(error));
  }
}


function decodeClaimKey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("empty");
  const bytes = Buffer.from(trimmed, "base64url");
  if (bytes.length !== CLAIM_KEY_BYTES) throw new Error("length");
  return new Uint8Array(bytes);
}

let pairPlay: Promise<void> = Promise.resolve();
function queuePairPlayback(code: string): void {
  pairPlay = pairPlay.then(() => Promise.resolve(playPairCode(code))).catch(() => {});
}

const tailscaleIp = tailscaleIPv4();
const HOST = process.env.DASH_HOST ?? "0.0.0.0";
const TOKEN = loadToken();

function bridgeAddress(): string {
  const host = tailscaleIp ?? (HOST !== "0.0.0.0" ? HOST : "127.0.0.1");
  return `${host}:${PORT}`;
}

function pairDeepLink(code: string): string {
  return `dash://connect?address=${encodeURIComponent(bridgeAddress())}&code=${encodeURIComponent(code)}`;
}

const claimFailures = new Map<string, { count: number; resetAt: number }>();

function claimRateLimited(remote: string): boolean {
  const now = Date.now();
  const entry = claimFailures.get(remote);
  if (!entry || entry.resetAt <= now) {
    claimFailures.set(remote, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > 12;
}

async function handleHttp(request: Request, url: URL): Promise<Response | null> {
  const address = bridgeAddress();

  if (url.pathname === "/pair" && request.method === "GET") {
    const session = currentOrCreateSession();
    return Response.json({
      code: session.code,
      host: HOST_NAME,
      address,
      port: PORT,
      expiresAt: session.expiresAt,
      link: pairDeepLink(session.code),
    });
  }

  if (url.pathname === "/pair/intent" && request.method === "POST") {
    const body = parseJson(await request.text());
    const claimKeyRaw =
      typeof body === "object" && body !== null && "claimKey" in body && typeof body.claimKey === "string"
        ? body.claimKey
        : "";
    let claimKey: Uint8Array;
    try {
      claimKey = decodeClaimKey(claimKeyRaw);
    } catch {
      return Response.json({ error: "invalid claim key" }, { status: 400 });
    }
    const session = startBoundSession(claimKey);
    queuePairPlayback(session.code);
    log("pair.intent", { session: session.id });
    return Response.json({ ok: true, expiresAt: session.expiresAt, host: HOST_NAME, address });
  }

  if (url.pathname === "/pair/beep" && request.method === "POST") {
    const session = currentOrCreateSession();
    queuePairPlayback(session.code);
    log("pair.beep", { session: session.id });
    return Response.json({ ok: true, expiresAt: session.expiresAt, host: HOST_NAME, address });
  }


  if (url.pathname === "/pair/hear" && request.method === "POST") {
    const body = parseJson(await request.text());
    const rec = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    let claimKey: Uint8Array;
    try {
      claimKey = decodeClaimKey(typeof rec.claimKey === "string" ? rec.claimKey : "");
    } catch {
      return Response.json({ error: "invalid claim key" }, { status: 400 });
    }
    const audioB64 = typeof rec.audio === "string" ? rec.audio : "";
    if (!audioB64) return Response.json({ error: "missing audio" }, { status: 400 });
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(Buffer.from(audioB64, "base64"));
    } catch {
      return Response.json({ error: "invalid audio" }, { status: 400 });
    }
    const heard = await decodePairAudio(bytes);
    if (!heard) return Response.json({ error: "could not hear pairing tones" }, { status: 422 });
    const session = claimSession(heard, claimKey);
    if (!session) return Response.json({ error: "invalid or expired code" }, { status: 401 });
    log("pair.hear", { session: session.id, code: heard });
    return Response.json({
      address,
      token: TOKEN,
      host: HOST_NAME,
      cwd: DEFAULT_CWD,
      harnesses: harnessList(),
    });
  }

  if (url.pathname === "/pair/claim" && request.method === "POST") {
    const remote = request.headers.get("x-forwarded-for") ?? "local";
    if (claimRateLimited(remote)) return Response.json({ error: "too many attempts" }, { status: 429 });
    const body = parseJson(await request.text());
    const code =
      typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
        ? body.code
        : "";
    let claimKey: Uint8Array | undefined;
    if (typeof body === "object" && body !== null && "claimKey" in body && typeof body.claimKey === "string") {
      try {
        claimKey = decodeClaimKey(body.claimKey);
      } catch {
        return Response.json({ error: "invalid claim key" }, { status: 400 });
      }
    }
    const session = claimSession(code, claimKey);
    if (!session) return Response.json({ error: "invalid or expired code" }, { status: 401 });
    log("pair.claim", { remote, session: session.id });
    return Response.json({
      address,
      token: TOKEN,
      host: HOST_NAME,
      cwd: DEFAULT_CWD,
      harnesses: harnessList(),
    });
  }

  if (url.pathname === "/roster" && request.method === "GET") {
    const token = url.searchParams.get("token") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (token !== TOKEN) return new Response("unauthorized", { status: 401 });
    const harnesses = harnessList();
    return Response.json({
      host: HOST_NAME,
      hosts: collectRoster(harnesses, { hostname: HOST_NAME, address: address.split(":")[0] }),
    });
  }

  if (url.pathname === "/") {
    return Response.json({ ok: true, host: HOST_NAME, cwd: DEFAULT_CWD, harnesses: harnessList(), pair: "/pair" });
  }

  return null;
}

const server = Bun.serve<SocketData>({
  hostname: HOST,
  port: PORT,
  async fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname !== "/ws") {
      const http = await handleHttp(request, url);
      return http ?? new Response("not found", { status: 404 });
    }
    if (url.searchParams.get("token") !== TOKEN) {
      return new Response("unauthorized", { status: 401 });
    }
    if (server.upgrade(request, { data: { turns: new Set() } })) return;
    return new Response("upgrade failed", { status: 400 });
  },
  websocket: {
    idleTimeout: 0,
    open(ws) {
      log("ws.open", { remote: ws.remoteAddress });
      const harnesses = harnessList();
      sendTo(ws, {
        type: "hello",
        version: PROTOCOL_VERSION,
        host: HOST_NAME,
        cwd: DEFAULT_CWD,
        harnesses,
        hosts: collectRoster(harnesses, { hostname: HOST_NAME, address: tailscaleIp ?? undefined }),
      });
    },
    message(ws, raw) {
      const message = parseClientMessage(parseJson(raw));
      if (!message) {
        log("ws.bad_message", { remote: ws.remoteAddress });
        return;
      }
      switch (message.type) {
        case "chat": {
          if (turns.has(message.id)) return;
          const harness = HARNESSES.find((h) => h.id === message.harness);
          if (!harness) return rejectTurn(ws, message.id, `Unknown agent "${message.harness}".`);
          if (harness.id !== "hermes" && Bun.which(harness.bin) === null) {
            return rejectTurn(
              ws,
              message.id,
              `${harness.name} isn't installed on ${HOST_NAME} ("${harness.bin}" not on PATH).`,
            );
          }
          const cwd = message.cwd?.trim() || DEFAULT_CWD;
          if (!isDirectory(cwd)) return rejectTurn(ws, message.id, `Not a directory on ${HOST_NAME}: ${cwd}`);

          const turn = new Turn(message.id, harness);
          turn.listeners.add(ws);
          ws.data.turns.add(message.id);
          turns.set(message.id, turn);
          turn.start({ text: message.text, cwd, sessionId: message.sessionId });
          break;
        }
        case "voice_begin": {
          if (turns.has(message.id) || utterances.has(message.id)) return;
          const ready = speechAvailable();
          if (!ready.ok) {
            return rejectTurn(ws, message.id, ready.reason ?? "Speech isn't set up on this computer.");
          }
          const harness = HARNESSES.find((h) => h.id === message.harness);
          if (!harness) return rejectTurn(ws, message.id, `Unknown agent "${message.harness}".`);
          if (harness.id !== "hermes" && Bun.which(harness.bin) === null) {
            return rejectTurn(
              ws,
              message.id,
              `${harness.name} isn't installed on ${HOST_NAME} ("${harness.bin}" not on PATH).`,
            );
          }
          const cwd = message.cwd?.trim() || DEFAULT_CWD;
          if (!isDirectory(cwd)) return rejectTurn(ws, message.id, `Not a directory on ${HOST_NAME}: ${cwd}`);

          const turn = new Turn(message.id, harness);
          turn.listeners.add(ws);
          ws.data.turns.add(message.id);
          turns.set(message.id, turn);
          utterances.set(message.id, {
            chunks: [],
            bytes: 0,
            cwd,
            sessionId: message.sessionId,
            startedAt: Date.now(),
          });
          break;
        }
        case "voice_chunk": {
          const utterance = utterances.get(message.id);
          if (!utterance) return;
          const slice = Buffer.from(message.data, "base64");
          utterance.bytes += slice.byteLength;
          if (utterance.bytes > MAX_UTTERANCE_BYTES) {
            utterances.delete(message.id);
            turns.get(message.id)?.endWithout("That recording was too long.");
            return;
          }
          utterance.chunks.push(new Uint8Array(slice));
          break;
        }
        case "voice_commit": {
          const pending = utterances.get(message.id);
          if (!pending) return;
          utterances.delete(message.id);
          const voiceTurn = turns.get(message.id);
          if (voiceTurn) void runVoiceTurn(voiceTurn, pending);
          break;
        }
        case "cancel": {
          utterances.delete(message.id);
          turns.get(message.id)?.cancel();
          break;
        }
        case "attach":
          for (const { id, seq } of message.turns) {
            const turn = turns.get(id);
            if (!turn) {
              sendTo(ws, { type: "lost", id });
              continue;
            }
            turn.listeners.add(ws);
            ws.data.turns.add(id);
            turn.replay(ws, seq);
          }
          log("ws.attach", { remote: ws.remoteAddress, count: message.turns.length });
          break;
        case "history": {
          const home = homedir();
          const sessionRoot = join(process.env.PI_CODING_AGENT_DIR ?? join(home, ".omp", "agent"), "sessions");
          sendTo(ws, {
            type: "history",
            harness: message.harness,
            sessionId: message.sessionId,
            messages: readLiveTranscript(message.harness, message.sessionId, sessionRoot, message.cwd, home),
          });
          break;
        }
      }
    },
    close(ws) {
      for (const id of ws.data.turns) {
        turns.get(id)?.listeners.delete(ws);
        // A half-uploaded utterance can't be resumed on another socket.
        utterances.delete(id);
      }
      log("ws.close", { remote: ws.remoteAddress, subscribed: ws.data.turns.size });
      ws.data.turns.clear();
    },
  },
});

const agents = harnessList()
  .map((h) => `${h.id} ${h.available ? "✓" : "✗"}`)
  .join("  ");

const speech = speechAvailable();
if (speech.ok) {
  // Loading the model costs ~13s. Pay it now so the first spoken turn isn't the slow one.
  void warmup().then(
    () => log("speech.ready", {}),
    (error: unknown) => log("speech.load_failed", { error: String(error) }),
  );
}

const pairSession = currentOrCreateSession();
process.stderr.write(
  [
    "",
    `  dash bridge   ws://${server.hostname}:${server.port}/ws?token=${TOKEN}`,
    `  computer      ${HOST_NAME}`,
    `  cwd           ${DEFAULT_CWD}`,
    `  agents        ${agents}`,
    `  voice         ${speech.ok ? "loading model…" : `unavailable — ${speech.reason ?? "not set up"}`}`,
    "",
    `  pair code     ${pairSession.code}  (terminal fallback — use Dash sonic pair when possible)`,
    "",
    tailscaleIp
      ? `  Tailscale       ${tailscaleIp}:${server.port}  ·  computer name "${HOST_NAME}"`
      : "  Tailscale not detected; listening on all interfaces. Set DASH_HOST to restrict.",
    "",
  ].join("\n"),
);
