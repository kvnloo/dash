import type { Subprocess } from "bun";
import type { TurnEvent } from "../../shared/protocol";
import type { Harness, HarnessEvent, TurnInput } from "./harnesses/types";
import { log } from "./log";

export type Sink = (event: TurnEvent) => void;

const DELTA_FLUSH_MS = 30;
const STDERR_TAIL_LINES = 12;
const KILL_GRACE_MS = 3000;

type TurnEventBody = TurnEvent extends infer E
  ? E extends TurnEvent
    ? Omit<E, "id" | "seq">
    : never
  : never;

/**
 * One harness invocation. Owns the child process, buffers every event it
 * produced (so a reconnecting phone can replay from a sequence number), and
 * fans live events out to whichever sockets are currently attached.
 */
export class Turn {
  readonly events: TurnEvent[] = [];
  finished = false;
  finishedAt = 0;

  private seq = 0;
  private readonly sinks = new Set<Sink>();
  private pendingDelta = "";
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private proc: Subprocess<"ignore", "pipe", "pipe"> | undefined;
  private cancelled = false;
  private gotText = false;
  private readonly stderrTail: string[] = [];

  constructor(
    readonly harness: Harness,
    readonly id: string,
    private readonly input: TurnInput,
  ) {}

  start(): void {
    const cmd = this.harness.command(this.input);
    log.info("turn start", { id: this.id, harness: this.harness.id, cwd: this.input.cwd });
    this.push({ type: "status", text: `Starting ${this.harness.name}` });
    try {
      this.proc = Bun.spawn(cmd, {
        cwd: this.input.cwd,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
      });
    } catch (error) {
      this.push({ type: "error", message: `Could not start ${this.harness.name}: ${String(error)}` });
      this.finish();
      return;
    }
    const parser = this.harness.parser((event) => this.onHarnessEvent(event));
    const stdout = readLines(this.proc.stdout, (line) => parser.stdout(line));
    const stderr = readLines(this.proc.stderr, (line) => {
      parser.stderr(line);
      if (line.trim()) {
        this.stderrTail.push(line);
        if (this.stderrTail.length > STDERR_TAIL_LINES) this.stderrTail.shift();
      }
    });
    void Promise.all([this.proc.exited, stdout, stderr]).then(([exitCode]) => {
      parser.end();
      this.flushDelta();
      if (this.cancelled) {
        this.push({ type: "status", text: "Stopped" });
        this.push({ type: "done", exitCode });
      } else if (exitCode !== 0 && !this.gotText) {
        const detail = this.stderrTail.join("\n").trim();
        this.push({
          type: "error",
          message: `${this.harness.name} exited with code ${exitCode}${detail ? `\n${detail}` : ""}`,
        });
      } else {
        this.push({ type: "done", exitCode });
      }
      this.finish();
    });
  }

  /** Replay everything after `fromSeq`, then keep the sink live. */
  attach(sink: Sink, fromSeq: number): void {
    for (const event of this.events) if (event.seq > fromSeq) sink(event);
    if (!this.finished) this.sinks.add(sink);
  }

  detach(sink: Sink): void {
    this.sinks.delete(sink);
  }

  cancel(): void {
    if (this.finished || this.cancelled || !this.proc) return;
    this.cancelled = true;
    log.info("turn cancel", { id: this.id });
    const proc = this.proc;
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (!this.finished) proc.kill("SIGKILL");
    }, KILL_GRACE_MS);
  }

  private onHarnessEvent(event: HarnessEvent): void {
    switch (event.kind) {
      case "session":
        this.push({ type: "session", sessionId: event.sessionId });
        return;
      case "delta":
        this.gotText = true;
        this.pendingDelta += event.text;
        this.flushTimer ??= setTimeout(() => this.flushDelta(), DELTA_FLUSH_MS);
        return;
      case "status":
        this.push({ type: "status", text: event.text });
        return;
      default: {
        const _exhaustive: never = event;
        return _exhaustive;
      }
    }
  }

  private flushDelta(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (!this.pendingDelta) return;
    const text = this.pendingDelta;
    this.pendingDelta = "";
    this.push({ type: "delta", text });
  }

  /** Assign a sequence number, record, and broadcast. Non-delta events flush pending text first. */
  private push(body: TurnEventBody): void {
    if (body.type !== "delta") this.flushDelta();
    const event: TurnEvent = { ...body, id: this.id, seq: ++this.seq };
    this.events.push(event);
    for (const sink of this.sinks) sink(event);
  }

  private finish(): void {
    this.finished = true;
    this.finishedAt = Date.now();
    this.sinks.clear();
    log.info("turn end", { id: this.id, events: this.events.length });
  }
}

async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      onLine(buffer.slice(0, newline).replace(/\r$/, ""));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer) onLine(buffer);
}
