import {
  isRecord,
  TextTracker,
  truncate,
  tryParseJson,
  type Harness,
  type HarnessEvent,
} from "./types";

// Codex wraps every command as `/usr/bin/bash -lc '<cmd>'`; show just <cmd>.
const SHELL_WRAPPER = /^(?:\/\S+\/)?(?:bash|sh|zsh)\s+-lc\s+'([\s\S]*)'$/;

function unwrapCommand(command: string): string {
  const match = SHELL_WRAPPER.exec(command);
  return match?.[1] ?? command;
}

/** Codex CLI: `codex exec --json` emits thread/turn/item JSONL. No token streaming. */
export const codex: Harness = {
  id: "codex",
  name: "Codex",
  bin: "codex",
  command({ prompt, sessionId, cwd }) {
    const common = ["--json", "--skip-git-repo-check", "-C", cwd, "-s", "workspace-write"];
    return sessionId
      ? ["codex", "exec", "resume", ...common, sessionId, prompt]
      : ["codex", "exec", ...common, prompt];
  },
  parser(emit: (event: HarnessEvent) => void) {
    const text = new TextTracker(emit);
    let failure = "";

    function onItem(item: Record<string, unknown>, completed: boolean): void {
      switch (item.type) {
        case "agent_message":
          if (completed && typeof item.text === "string") text.block(item.text);
          return;
        case "command_execution":
          if (!completed && typeof item.command === "string") {
            emit({ kind: "status", text: truncate(`$ ${unwrapCommand(item.command)}`, 96) });
          }
          return;
        case "file_change":
          if (completed && Array.isArray(item.changes)) {
            const n = item.changes.length;
            emit({ kind: "status", text: `Edited ${n} file${n === 1 ? "" : "s"}` });
          }
          return;
        case "reasoning":
          if (!completed) emit({ kind: "status", text: "Thinking" });
          return;
        case "web_search":
          if (typeof item.query === "string") {
            emit({ kind: "status", text: truncate(`Searching ${item.query}`, 96) });
          }
          return;
        case "mcp_tool_call":
          if (typeof item.server === "string" && typeof item.tool === "string") {
            emit({ kind: "status", text: `${item.server}.${item.tool}` });
          }
          return;
        case "error":
          if (typeof item.message === "string") failure = item.message;
          return;
        default:
          return;
      }
    }

    return {
      stdout(line) {
        const event = tryParseJson(line);
        if (!isRecord(event)) return;
        switch (event.type) {
          case "thread.started":
            if (typeof event.thread_id === "string") {
              emit({ kind: "session", sessionId: event.thread_id });
            }
            return;
          case "item.started":
            if (isRecord(event.item)) onItem(event.item, false);
            return;
          case "item.completed":
            if (isRecord(event.item)) onItem(event.item, true);
            return;
          case "turn.failed":
            if (isRecord(event.error) && typeof event.error.message === "string") {
              failure = event.error.message;
            }
            return;
          case "error":
            if (typeof event.message === "string") failure = event.message;
            return;
          default:
            return;
        }
      },
      stderr() {},
      end() {
        if (!text.hasText && failure) text.block(failure);
      },
    };
  },
};
