import { describe, expect, test } from "bun:test";
import { replyFeedback, toolProgressLabel, compactToolPreview } from "./turn-feedback";
import type { ToolView } from "./reply-details";

const tool: ToolView = { id: "read", name: "read_file", summary: "source.ts", args: "{}", output: "", status: "live", durationMs: 0, truncated: false, detailLoaded: false };
describe("truthful turn feedback", () => {
  test("queue and connection override optimistic activity", () => {
    expect(replyFeedback({ handoff: "queued", status: "Working" }, true, true)).toBe("Waiting to send");
    expect(replyFeedback({ status: "Reading source" }, false, true)).toBe("Waiting for connection");
    expect(replyFeedback({}, true, false)).toBe("Waiting for reply");
    expect(replyFeedback({ status: "Working" }, true, true)).toBe("Writing reply");
    expect(replyFeedback({ status: "Reading source" }, true, true)).toBe("Reading source");
  });
  test("outcomes stay explicit for mixed parallel tool groups", () => {
    expect(toolProgressLabel([tool])).toBe("1 tool · 1 running");
    expect(toolProgressLabel([tool, { ...tool, id: "error", status: "error" }])).toBe("2 tools · 1 running, 1 failed");
    expect(toolProgressLabel([{ ...tool, status: "ok" }])).toBe("1 tool · complete");
    expect(toolProgressLabel([{ ...tool, status: "error" }])).toBe("1 tool · 1 failed");
  });
});

test("queued handoff is not host-admitted online or offline", () => {
  for (const connected of [true, false]) {
    expect(replyFeedback({ handoff: "queued", status: "Working" }, connected, true)).toBe("Waiting to send");
  }
});
test("compact preview follows current action and retains the failed count", () => {
  const tools: ToolView[] = [{ ...tool, id: "old", status: "error" }, { ...tool, id: "new" }];
  expect(compactToolPreview(tools)?.tool.id).toBe("new");
  expect(toolProgressLabel(tools)).toBe("2 tools · 1 running, 1 failed");
});
test("compact terminal preview parses oversized structured failure before bounding display", () => {
  const output = JSON.stringify({ exit_code: 7, output: "x".repeat(5000) + "\nlast diagnostic" });
  const preview = compactToolPreview([{ ...tool, name: "terminal", args: '{"command":"check"}', status: "error", output }]);
  expect(preview?.formatted.detail).toContain("exit 7");
  expect(preview?.formatted.output).toContain("last diagnostic");
});
