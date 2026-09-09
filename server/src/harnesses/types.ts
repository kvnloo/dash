/** Normalized events a harness adapter extracts from its CLI's output. */
export type HarnessEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "delta"; text: string }
  | { kind: "status"; text: string };

export interface TurnInput {
  prompt: string;
  sessionId?: string;
  cwd: string;
}

export interface LineParser {
  stdout(line: string): void;
  stderr(line: string): void;
  /** Called once after the process exits and all output has been parsed. */
  end(): void;
}

export interface Harness {
  id: string;
  name: string;
  /** Executable looked up on PATH to decide availability. */
  bin: string;
  /** Build the argv for one turn. `cmd[0]` is the executable. */
  command(input: TurnInput): string[];
  parser(emit: (event: HarnessEvent) => void): LineParser;
}

export function tryParseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const ARG_KEYS = [
  "command",
  "cmd",
  "path",
  "file_path",
  "filePath",
  "target_file",
  "pattern",
  "query",
  "url",
  "description",
];

/** One-line summary of a tool call for the status line: `bash echo hi`. */
export function describeTool(name: string, args: unknown): string {
  if (isRecord(args)) {
    for (const key of ARG_KEYS) {
      const value = args[key];
      if (typeof value === "string" && value.trim()) {
        return truncate(`${name} ${value.trim().replace(/\s+/g, " ")}`, 96);
      }
    }
  }
  return name;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Tracks assistant text across a turn so adapters can (a) separate distinct
 * text blocks with a blank line and (b) back-fill text a streaming API only
 * delivered in its final whole-message form.
 */
export class TextTracker {
  private emittedAny = false;
  private messageText = "";
  private blockPending = false;

  constructor(private readonly emit: (event: HarnessEvent) => void) {}

  get hasText(): boolean {
    return this.emittedAny;
  }

  /** A new assistant message begins (after a tool round-trip, for example). */
  startMessage(): void {
    this.messageText = "";
    this.blockPending = false;
  }

  /** A new text block begins inside the current message. */
  startBlock(): void {
    this.blockPending = true;
  }

  delta(text: string): void {
    if (!text) return;
    if (this.blockPending) {
      this.blockPending = false;
      if (this.emittedAny) this.emit({ kind: "delta", text: "\n\n" });
      if (this.messageText) this.messageText += "\n\n";
    }
    this.messageText += text;
    this.emittedAny = true;
    this.emit({ kind: "delta", text });
  }

  /**
   * The full text of the current message, from a whole-message event.
   * Emits whatever the stream skipped.
   */
  reconcileMessage(full: string): void {
    if (full.length <= this.messageText.length || !full.startsWith(this.messageText)) return;
    const remainder = full.slice(this.messageText.length);
    if (!this.messageText && this.emittedAny) this.emit({ kind: "delta", text: "\n\n" });
    this.messageText = full;
    this.emittedAny = true;
    this.emit({ kind: "delta", text: remainder });
  }

  /** A standalone complete block of text (non-streaming harnesses). */
  block(text: string): void {
    if (!text) return;
    this.startMessage();
    this.startBlock();
    this.delta(text);
  }
}
