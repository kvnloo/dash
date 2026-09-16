import { describe, expect, test } from "bun:test";
import {
  effortIdForTurn,
  lastAssistantState,
  runtimeStateFromAgent,
  runtimeStateFromOrchestra,
  runtimeStateFromTurn,
} from "./runtime-state";

describe("runtime state mapping", () => {
  test("maps bridge turn status onto visual.json runtimeStates", () => {
    expect(runtimeStateFromTurn({ turnState: "pending" })).toBe("claimed");
    expect(runtimeStateFromTurn({ turnState: "streaming" })).toBe("running");
    expect(runtimeStateFromTurn({ turnState: "interrupted" })).toBe("stale");
    expect(runtimeStateFromTurn({ turnState: "error" })).toBe("blocked");
    expect(runtimeStateFromTurn({ turnState: "done" })).toBe("unknown");
  });

  test("stale wins when the agent or bridge is offline during a turn", () => {
    expect(runtimeStateFromTurn({ turnState: "streaming", agentStatus: "offline" })).toBe("stale");
    expect(runtimeStateFromTurn({ turnState: "streaming", connectionStatus: "offline" })).toBe("stale");
    expect(runtimeStateFromTurn({ turnState: "pending", connectionStatus: "offline" })).toBe("claimed");
  });

  test("maps agent status onto visual.json runtimeStates", () => {
    expect(runtimeStateFromAgent("running")).toBe("running");
    expect(runtimeStateFromAgent("available")).toBe("paused");
    expect(runtimeStateFromAgent("offline")).toBe("stale");
    expect(runtimeStateFromAgent(undefined)).toBe("unknown");
  });

  test("maps orchestra rows from catalog status plus live streaming", () => {
    expect(runtimeStateFromOrchestra({ status: "active", streaming: false })).toBe("claimed");
    expect(runtimeStateFromOrchestra({ status: "active", streaming: true })).toBe("running");
    expect(runtimeStateFromOrchestra({ status: "paused", streaming: false })).toBe("paused");
    expect(runtimeStateFromOrchestra({ status: "idle", streaming: false })).toBe("stale");
    expect(runtimeStateFromOrchestra({ status: "paused", streaming: true })).toBe("running");
  });

  test("streaming turns use standard effort; unknown ids pass through to fail closed", () => {
    expect(effortIdForTurn({ turnState: "streaming" })).toBe("standard");
    expect(effortIdForTurn({ turnState: "pending" })).toBeUndefined();
    expect(effortIdForTurn({ turnState: "streaming", effortId: "high" })).toBe("high");
    expect(effortIdForTurn({ turnState: "streaming", effortId: "not-an-effort" })).toBe("not-an-effort");
  });

  test("reads the last assistant turn state from a conversation", () => {
    expect(lastAssistantState([])).toBeUndefined();
    expect(lastAssistantState([{ role: "user" }])).toBeUndefined();
    expect(lastAssistantState([{ role: "assistant", state: "streaming" }])).toBe("streaming");
    expect(
      lastAssistantState([
        { role: "assistant", state: "done" },
        { role: "user" },
        { role: "assistant", state: "pending" },
      ]),
    ).toBe("pending");
  });
});
