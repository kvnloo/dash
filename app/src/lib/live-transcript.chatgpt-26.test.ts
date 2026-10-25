import { describe, expect, test } from "bun:test";
import type { HistoryMessage, HostInfo } from "../../../shared/protocol";
import type { Conversation } from "../model";
import { hydrateLiveConversation, mergeLiveConversations, shouldRequestHistory } from "../lib/live-sessions";

const now = Date.parse("2026-10-25T10:00:05.000Z");
const hosts: HostInfo[] = [{
  id: "mbp", name: "mbp", hostname: "mbp", online: true, self: true,
  agents: [{
    id: "omp:tab-a", name: "OMP", kind: "omp", status: "running",
    sessionId: "omp-session-a", cwd: "/home/projects/alpha",
  }],
}];

// The bridge JSONL reader returns this HistoryMessage shape; app tests must not import bridge modules.
const history: HistoryMessage[] = [
  { id: "u1", role: "user", text: "Show me this OMP tab", at: Date.parse("2026-10-25T10:00:00.000Z") },
  { id: "a1", role: "assistant", text: "History from alpha", at: Date.parse("2026-10-25T10:00:03.000Z") },
];

describe("issue #26: live OMP conversation hydration", () => {
  test("opening a live row hydrates history without changing its identity or creating another chat", () => {
    const [live] = mergeLiveConversations([], hosts, now);
    if (!live) throw new Error("Live OMP row was not adopted");
    expect(live.id).toBe("live:omp:omp-session-a");
    expect(live.sessionId).toBe("omp-session-a");
    expect(live.cwd).toBe("/home/projects/alpha");
    expect(live.messages).toEqual([]);
    expect(shouldRequestHistory(live)).toBe(true);

    const hydrated = hydrateLiveConversation(live, history);
    expect(hydrated.id).toBe(live.id);
    expect(hydrated.sessionId).toBe("omp-session-a");
    expect(hydrated.messages.map(message => ({ id: message.id, role: message.role, text: message.text }))).toEqual([
      { id: "u1", role: "user", text: "Show me this OMP tab" },
      { id: "a1", role: "assistant", text: "History from alpha" },
    ]);
    expect(shouldRequestHistory(hydrated)).toBe(false);

    const afterRefresh = mergeLiveConversations([hydrated], hosts, now + 1);
    expect(afterRefresh).toHaveLength(1);
    expect(afterRefresh[0]).toBe(hydrated);
  });

  test("in-flight assistant turns stay attached and are not overwritten by history", () => {
    const [live] = mergeLiveConversations([], hosts, now);
    if (!live) throw new Error("Live OMP row was not adopted");
    const streaming: Conversation = {
      ...live,
      messages: [{
        id: "a-running", role: "assistant", state: "streaming",
        text: "partial", at: now, turnId: "turn-in-flight", seq: 3,
      }],
    };
    expect(shouldRequestHistory(streaming)).toBe(false);
    expect(hydrateLiveConversation(streaming, history)).toBe(streaming);

    const afterRefresh = mergeLiveConversations([streaming], hosts, now + 1);
    expect(afterRefresh).toHaveLength(1);
    expect(afterRefresh[0]).toBe(streaming);
    expect(afterRefresh[0]?.messages[0]).toEqual(streaming.messages[0]);
  });
});
