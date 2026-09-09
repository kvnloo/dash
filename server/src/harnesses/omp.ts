import {
  describeTool,
  isRecord,
  TextTracker,
  tryParseJson,
  type Harness,
  type HarnessEvent,
} from "./types";

/** OhMyPi: `omp -p --mode json` emits one JSON event per line. */
export const omp: Harness = {
  id: "omp",
  name: "OhMyPi",
  bin: "omp",
  command({ prompt, sessionId, cwd }) {
    const args = ["omp", "-p", "--mode", "json", "--auto-approve", "--no-title", "--cwd", cwd];
    if (sessionId) args.push("-r", sessionId);
    args.push(prompt);
    return args;
  },
  parser(emit: (event: HarnessEvent) => void) {
    const text = new TextTracker(emit);
    // Characters emitted so far per content block index, to back-fill from `text_end`.
    const blockEmitted = new Map<number, number>();
    return {
      stdout(line) {
        const event = tryParseJson(line);
        if (!isRecord(event)) return;
        switch (event.type) {
          case "session":
            if (typeof event.id === "string") emit({ kind: "session", sessionId: event.id });
            return;
          case "message_start":
            if (isRecord(event.message) && event.message.role === "assistant") {
              text.startMessage();
              blockEmitted.clear();
            }
            return;
          case "message_update": {
            const inner = event.assistantMessageEvent;
            if (!isRecord(inner) || typeof inner.contentIndex !== "number") return;
            const index = inner.contentIndex;
            switch (inner.type) {
              case "text_start":
                text.startBlock();
                blockEmitted.set(index, 0);
                return;
              case "text_delta":
                if (typeof inner.delta === "string") {
                  text.delta(inner.delta);
                  blockEmitted.set(index, (blockEmitted.get(index) ?? 0) + inner.delta.length);
                }
                return;
              case "text_end":
                if (typeof inner.content === "string") {
                  const seen = blockEmitted.get(index) ?? 0;
                  if (inner.content.length > seen) text.delta(inner.content.slice(seen));
                }
                return;
              case "thinking_start":
                emit({ kind: "status", text: "Thinking" });
                return;
              default:
                return;
            }
          }
          case "tool_execution_start":
            if (typeof event.toolName === "string") {
              emit({ kind: "status", text: describeTool(event.toolName, event.args) });
            }
            return;
          default:
            return;
        }
      },
      stderr() {},
      end() {},
    };
  },
};
