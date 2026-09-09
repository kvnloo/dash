import {
  describeTool,
  isRecord,
  TextTracker,
  tryParseJson,
  type HarnessEvent,
  type LineParser,
} from "./types";

/**
 * Parser for CLIs that speak the Anthropic Messages stream format wrapped in
 * `{"type":"stream_event","event":{...}}` lines, with `system/init`,
 * whole `assistant` messages, and a final `result`. Claude Code and Grok both do.
 */
export function anthropicStreamParser(emit: (event: HarnessEvent) => void): LineParser {
  const text = new TextTracker(emit);
  const toolInputs = new Map<number, { name: string; json: string }>();
  let resultText = "";

  function onStreamEvent(event: Record<string, unknown>): void {
    const index = typeof event.index === "number" ? event.index : undefined;
    switch (event.type) {
      case "message_start":
        text.startMessage();
        toolInputs.clear();
        return;
      case "content_block_start": {
        const block = event.content_block;
        if (!isRecord(block) || index === undefined) return;
        if (block.type === "text") text.startBlock();
        else if (block.type === "thinking") emit({ kind: "status", text: "Thinking" });
        else if (block.type === "tool_use" && typeof block.name === "string") {
          toolInputs.set(index, { name: block.name, json: "" });
          emit({ kind: "status", text: block.name });
        }
        return;
      }
      case "content_block_delta": {
        const delta = event.delta;
        if (!isRecord(delta)) return;
        if (delta.type === "text_delta" && typeof delta.text === "string") text.delta(delta.text);
        else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
          const tool = index === undefined ? undefined : toolInputs.get(index);
          if (tool) tool.json += delta.partial_json;
        }
        return;
      }
      case "content_block_stop": {
        if (index === undefined) return;
        const tool = toolInputs.get(index);
        if (tool) {
          emit({ kind: "status", text: describeTool(tool.name, tryParseJson(tool.json)) });
          toolInputs.delete(index);
        }
        return;
      }
      default:
        return;
    }
  }

  function onAssistantMessage(message: Record<string, unknown>): void {
    if (!Array.isArray(message.content)) return;
    const parts: string[] = [];
    for (const block of message.content) {
      if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
    text.reconcileMessage(parts.join("\n\n"));
  }

  return {
    stdout(line) {
      const event = tryParseJson(line);
      if (!isRecord(event)) return;
      switch (event.type) {
        case "system":
          if (event.subtype === "init" && typeof event.session_id === "string") {
            emit({ kind: "session", sessionId: event.session_id });
          }
          return;
        case "stream_event":
          if (isRecord(event.event)) onStreamEvent(event.event);
          return;
        case "assistant":
          if (isRecord(event.message)) onAssistantMessage(event.message);
          return;
        case "result":
          if (typeof event.result === "string") resultText = event.result;
          return;
        default:
          return;
      }
    },
    stderr() {},
    end() {
      // Errors (auth, quota) arrive only in `result`; surface them if nothing streamed.
      if (!text.hasText && resultText) text.block(resultText);
    },
  };
}
