import { describe, expect, test } from "bun:test";
import { voiceTarget } from "./voice-target";

const hermes = (id: string, updatedAt: number, extra: object = {}) => ({ id, harness: "hermes", sessionId: `s-${id}`, profileId: "default", updatedAt, ...extra });

describe("voice call target", () => {
  test("the open attached Hermes chat wins even when older", () => {
    const chats = [hermes("old", 1), hermes("new", 9)];
    expect(voiceTarget(chats, "old")?.id).toBe("old");
  });

  test("conversation mode without an attached open chat binds the most recent attached Hermes chat", () => {
    const chats = [hermes("a", 3), { id: "omp", harness: "omp", updatedAt: 10 }, hermes("b", 7), hermes("gone", 99, { stale: true })];
    expect(voiceTarget(chats, "omp")?.id).toBe("b");
    expect(voiceTarget(chats, null)?.id).toBe("b");
    expect(voiceTarget(chats, "missing")?.id).toBe("b");
  });

  test("a new Hermes chat without a session is not a target; no attached chat means no target", () => {
    const fresh = { id: "fresh", harness: "hermes", profileId: "default", updatedAt: 50 };
    expect(voiceTarget([fresh, hermes("x", 1)], "fresh")?.id).toBe("x");
    expect(voiceTarget([fresh], "fresh")).toBeUndefined();
  });
});
