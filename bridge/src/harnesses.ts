// One adapter per agent CLI. Each adapter knows two things: how to build the
// argv for a turn, and how to turn the CLI's stdout into protocol events.

import { hermesCliArgv } from "./hermes-session";

export interface TurnInput {
  text: string;
  cwd: string;
  sessionId?: string;
}

export interface Sink {
  session(sessionId: string): void;
  delta(text: string): void;
  /** Short line describing what the agent is doing right now. Empty string clears it. */
  status(text: string): void;
  error(message: string): void;
}

export interface TurnParser {
  /** One line of stdout, without the trailing newline. */
  line(line: string): void;
  /** Process exited; flush anything still buffered. */
  end(): void;
}

export interface Harness {
  id: string;
  name: string;
  bin: string;
  argv(input: TurnInput): string[];
  parser(sink: Sink): TurnParser;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): value is string {
  return typeof value === "string";
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  if (line.charCodeAt(0) !== 123 /* { */) return null;
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
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

// omp and pi share Pi's `--mode json` event stream (session, text_delta, tools).
function sessionNdjsonParser(sink: Sink): TurnParser {
  return {
    line(line) {
      const ev = parseJsonLine(line);
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
    end() {},
  };
}

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
  parser: sessionNdjsonParser,
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
        const ev = parseJsonLine(line);
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
      end() {},
    };
  },
};

// grok and claude both speak the Anthropic Messages wire format over NDJSON.
function anthropicStreamParser(sink: Sink): TurnParser {
  let sawDelta = false;
  return {
    line(line) {
      const ev = parseJsonLine(line);
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
    end() {},
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

// pi: Earendil CLI. `--mode json` is the documented event stream; `--approve`
// trusts project-local files in non-interactive mode. cwd comes from spawn.
const pi: Harness = {
  id: "pi",
  name: "Pi",
  bin: "pi",
  argv({ text, sessionId }) {
    return [
      "--mode",
      "json",
      "--approve",
      ...(sessionId ? ["--session", sessionId] : []),
      "--",
      text,
    ];
  },
  parser: sessionNdjsonParser,
};

// fx: `fx ask --json` emits one object with session_id, output, final_output.
// --full-access matches the other laptop adapters (approvals already bypassed).
function fxAskParser(sink: Sink): TurnParser {
  const lines: string[] = [];
  return {
    line(line) {
      lines.push(line);
    },
    end() {
      const raw = lines.join("\n").trim();
      if (!raw) return;
      const ev = parseJsonLine(raw);
      if (!ev) return;
      if (str(ev.session_id)) sink.session(ev.session_id);
      const text =
        str(ev.output) && ev.output.length > 0
          ? ev.output
          : str(ev.final_output)
            ? ev.final_output
            : "";
      if (text) sink.delta(text);
    },
  };
}

const fx: Harness = {
  id: "fx",
  name: "fx",
  bin: "fx",
  argv({ text, sessionId }) {
    return [
      "ask",
      "--json",
      "--full-access",
      ...(sessionId ? ["--resume-id", sessionId] : []),
      "--",
      text,
    ];
  },
  parser: fxAskParser,
};

export const HARNESSES: readonly Harness[] = [omp, codex, grok, claude, hermes, pi, fx];


