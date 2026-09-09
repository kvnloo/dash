import type { ServerMessage } from "../../shared/protocol";
import type { Harness, Sink, TurnInput } from "./harnesses";

export interface TurnHandle {
  cancel(): void;
}

interface TurnOptions {
  id: string;
  harness: Harness;
  input: TurnInput;
  send(message: ServerMessage): void;
  onFinish(): void;
  log(event: string, fields?: Record<string, unknown>): void;
}

/** Batches text deltas so a fast model doesn't turn into hundreds of tiny frames per second. */
const FLUSH_MS = 40;
const STDERR_TAIL = 2000;
const CANCELLED_EXIT_CODE = 130;

class Emitter implements Sink {
  private buffer = "";
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly id: string,
    private readonly send: (message: ServerMessage) => void,
  ) {}

  session(sessionId: string): void {
    this.flush();
    this.send({ type: "session", id: this.id, sessionId });
  }

  delta(text: string): void {
    if (!text) return;
    this.buffer += text;
    if (this.timer === null) this.timer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  status(text: string): void {
    this.flush();
    this.send({ type: "status", id: this.id, text });
  }

  error(message: string): void {
    this.flush();
    this.send({ type: "error", id: this.id, message });
  }

  done(exitCode: number): void {
    this.flush();
    this.send({ type: "done", id: this.id, exitCode });
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer) {
      this.send({ type: "delta", id: this.id, text: this.buffer });
      this.buffer = "";
    }
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

export function runTurn(options: TurnOptions): TurnHandle {
  const { id, harness, input, send, onFinish, log } = options;
  const emitter = new Emitter(id, send);
  const parser = harness.parser(emitter);
  const argv = [harness.bin, ...harness.argv(input)];
  let cancelled = false;

  const proc = Bun.spawn(argv, {
    cwd: input.cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", TERM: "dumb" },
  });

  log("turn.start", { id, harness: harness.id, pid: proc.pid, cwd: input.cwd, resume: Boolean(input.sessionId) });

  let stderrTail = "";
  const stdoutDone = readLines(proc.stdout, (line) => {
    try {
      parser.line(line);
    } catch (error) {
      log("turn.parse_error", { id, error: String(error) });
    }
  });
  const stderrDone = readLines(proc.stderr, (line) => {
    stderrTail = (stderrTail + line + "\n").slice(-STDERR_TAIL);
  });

  void (async () => {
    const exitCode = await proc.exited;
    await Promise.all([stdoutDone, stderrDone]);
    parser.end();
    if (cancelled) {
      emitter.done(CANCELLED_EXIT_CODE);
    } else {
      if (exitCode !== 0) {
        const detail = stderrTail.trim();
        emitter.error(detail ? detail : `${harness.name} exited with code ${exitCode}`);
      }
      emitter.done(exitCode);
    }
    log("turn.end", { id, harness: harness.id, exitCode, cancelled });
    onFinish();
  })();

  return {
    cancel() {
      if (cancelled) return;
      cancelled = true;
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (proc.exitCode === null) proc.kill("SIGKILL");
      }, 3000);
    },
  };
}
