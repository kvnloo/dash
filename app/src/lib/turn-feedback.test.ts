import { describe, expect, test } from "bun:test";
import { replyFeedback, toolProgressLabel } from "./turn-feedback";
import type { ToolView } from "./reply-details";

const tool: ToolView = { id: "read", name: "read_file", summary: "source.ts", args: "{}", output: "", status: "live", durationMs: 0, truncated: false, detailLoaded: false };
describe("truthful turn feedback", () => {
  test("queue and connection override optimistic activity", () => {
    expect(replyFeedback({ handoff: "queued", status: "Working" }, true, true)).toBe("Queued on host");
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
