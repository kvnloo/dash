import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AssistantMessage, Conversation } from "../model";
import { nextPendingSend, parkMessage } from "./offline-send";

const root = join(import.meta.dir, "../../..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const streaming: AssistantMessage = {
  id: "a1",
  role: "assistant",
  text: "",
  at: 1,
  state: "streaming",
  turnId: "t1",
  seq: 0,
};

describe("offline send parks and retries", () => {
  test("a failed send parks the assistant as pending, not error", () => {
    const parked = parkMessage(streaming);
    expect(parked.state).toBe("pending");
    expect(parked.error).toBeUndefined();
    expect(parked.turnId).toBe("t1");
  });

  test("reconnect flush picks the parked user text in order", () => {
    const conv: Conversation = {
      id: "c1",
      harness: "omp",
      title: "t",
      createdAt: 1,
      updatedAt: 1,
      messages: [
        { id: "u1", role: "user", text: "one", at: 1 },
        parkMessage(streaming),
      ],
    };
    expect(nextPendingSend(conv)).toEqual({
      turnId: "t1",
      harness: "omp",
      text: "one",
      sessionId: undefined,
      cwd: undefined,
    });
    const busy: Conversation = {
      ...conv,
      messages: [
        { id: "u1", role: "user", text: "one", at: 1 },
        { ...streaming, state: "streaming" },
      ],
    };
    expect(nextPendingSend(busy)).toBeNull();
  });

  test("ChatScreen and hello are wired to park/flush, not a hard error", () => {
    const chat = read("app/src/screens/ChatScreen.tsx");
    expect(chat).toContain("parkUnsentTurn");
    expect(chat.includes('message: "Not connected to the bridge."')).toBe(false);
    const bridge = read("app/src/net/bridge.ts");
    expect(bridge).toContain("flushPendingSends");
    const app = read("app/src/store/app.ts");
    expect(app).toContain("parkUnsentTurn");
    expect(app).toContain("flushPendingSends");
  });
});
