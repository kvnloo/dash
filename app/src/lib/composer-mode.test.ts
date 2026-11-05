import { expect, test } from "bun:test";
import { canSteer, composerMode } from "./composer-mode";
import { conversationThinking } from "./thinking";
import type { AssistantMessage } from "../model";
test("busy primary is Steer, toggle is Queue, idle is normal Send", () => {
  expect(composerMode(true)).toEqual({ mode: "steer", label: "Steer the running turn", action: "Steer" });
  expect(composerMode(true, "queue")).toEqual({ mode: "queue", label: "Queue for next turn", action: "Queue" });
  for (const choice of ["steer", "queue"] as const) expect(composerMode(false, choice)).toEqual({ mode: "queue", label: "", action: "Send" });
});
test("only existing Hermes busy phases expose steering, never libfx or another harness", () => {
  for (const phase of ["thinking", "tool", "streaming"] as const) expect(canSteer("hermes", "s", phase)).toBe(true);
  for (const phase of ["idle", "waiting-approval"] as const) expect(canSteer("hermes", "s", phase)).toBe(false);
  expect(canSteer("omp", "s", "tool")).toBe(false);
  expect(canSteer("hermes", undefined, "tool")).toBe(false);
  expect(canSteer("hermes", "s", "tool", true)).toBe(false);
});
test("later queued or steered receipt cannot eclipse the original running tool", () => {
  const running: AssistantMessage = { id: "a", role: "assistant", text: "", at: 0, state: "streaming", status: "Running terminal", turnId: "a", seq: 1 };
  for (const delivery of ["queued", "steered"] as const) expect(conversationThinking([running, {...running, id: "b", turnId: "b", delivery}], "online")).toEqual({ phase: "tool", tool: "terminal" });
});
