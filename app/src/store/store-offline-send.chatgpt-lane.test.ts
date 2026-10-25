import { describe, expect, test } from "bun:test";
import type { AssistantMessage, Conversation, Message, UserMessage } from "../model";
import { nextPendingSend, parkMessage } from "./offline-send";

// These are pure store helpers: no native imports, singleton stores, or mocks.
function assistant(
  state: AssistantMessage["state"],
  turnId: string,
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    id: "reply-" + turnId,
    role: "assistant",
    text: "",
    at: 2,
    state,
    turnId,
    seq: 0,
    ...overrides,
  };
}

function user(id: string, text: string, overrides: Partial<UserMessage> = {}): UserMessage {
  return { id, role: "user", text, at: 1, ...overrides };
}

function conversation(
  id: string,
  messages: Message[],
  overrides: Partial<Conversation> = {},
): Conversation {
  return {
    id,
    harness: "hermes",
    title: "Test conversation",
    createdAt: 1,
    updatedAt: 2,
    messages,
    ...overrides,
  };
}

describe("parkMessage: unsent turn eligibility and evidence", () => {
  test("done and interrupted remain terminal, including their existing evidence", () => {
    const states: AssistantMessage["state"][] = ["done", "interrupted"];
    for (const state of states) {
      const settled = assistant(state, "terminal-" + state, {
        text: "completed body",
        error: "prior diagnostic",
        status: "existing status",
        seq: 17,
        activity: ["prior tool activity"],
        handoff: "sending",
      });
      const snapshot = { ...settled };
      expect(parkMessage(settled)).toBe(settled);
      expect(settled).toEqual(snapshot);
      expect(nextPendingSend(conversation("settled", [user("u", "old request"), settled]))).toBeNull();
    }
  });

  test("streaming and already-pending replies park without mutating the original", () => {
    const states: AssistantMessage["state"][] = ["streaming", "pending"];
    for (const state of states) {
      const original = assistant(state, "unconfirmed-" + state, {
        text: "partial reply",
        error: "socket closed",
        status: "tool in progress",
        activity: ["existing evidence"],
        seq: 29,
        delivery: "queued",
        handoff: "queued",
      });
      const snapshot = { ...original };
      Object.freeze(original);
      const parked = parkMessage(original);

      expect(parked).not.toBe(original);
      expect(parked).toEqual({ ...snapshot, state: "pending", error: undefined, status: undefined });
      expect(parked.turnId).toBe(original.turnId);
      expect(parked.activity).toBe(original.activity);
      expect(original).toEqual(snapshot);
    }
  });
});

describe("nextPendingSend: conversation-local dispatch selection", () => {
  test("an empty conversation or pending assistant without an immediately preceding user is ineligible", () => {
    expect(nextPendingSend(conversation("empty", []))).toBeNull();
    expect(nextPendingSend(conversation("orphan", [assistant("pending", "orphan")]))).toBeNull();

    const noPair = conversation("not-adjacent", [
      assistant("pending", "at-start"),
      user("previous", "already settled"),
      assistant("done", "complete"),
      assistant("pending", "not-preceded-by-user"),
      user("last", "also complete"),
      assistant("interrupted", "interrupted"),
    ]);
    expect(nextPendingSend(noPair)).toBeNull();
  });

  test("the first valid pending reply selects its own immediately preceding text and session", () => {
    const conv = conversation("chat-a", [
      assistant("pending", "orphan"),
      user("first", " first\nrequest "),
      assistant("pending", "turn-first"),
      user("second", "second request"),
      assistant("pending", "turn-second"),
    ], {
      harness: "omp",
      sessionId: "session-a",
      cwd: "/projects/a",
    });

    expect(nextPendingSend(conv)).toEqual({
      turnId: "turn-first",
      harness: "omp",
      text: " first\nrequest ",
      sessionId: "session-a",
      cwd: "/projects/a",
    });
    expect(conv.messages[2]).toMatchObject({ state: "pending", turnId: "turn-first" });
    expect(conv.messages[4]).toMatchObject({ state: "pending", turnId: "turn-second" });
  });

  test("a streaming assistant blocks dispatch anywhere in the same conversation", () => {
    const layouts: Message[][] = [
      [
        user("queued", "queued first"),
        assistant("pending", "queued-first"),
        user("active", "active second"),
        assistant("streaming", "active-second"),
      ],
      [
        user("active", "active first"),
        assistant("streaming", "active-first"),
        user("queued", "queued second"),
        assistant("pending", "queued-second"),
      ],
    ];
    for (const messages of layouts) {
      expect(nextPendingSend(conversation("busy", messages))).toBeNull();
    }
  });

  test("done and interrupted replies do not block an unrelated pending pair", () => {
    const conv = conversation("idle", [
      user("completed", "already finished"),
      assistant("done", "finished"),
      user("stopped", "already interrupted"),
      assistant("interrupted", "stopped"),
      user("queued", "send this"),
      assistant("pending", "send-me"),
    ]);
    expect(nextPendingSend(conv)).toEqual({
      turnId: "send-me",
      harness: "hermes",
      text: "send this",
      sessionId: undefined,
      cwd: undefined,
    });
  });

  test("the exact empty-text payload is eligible without inventing a session or cwd", () => {
    const conv = conversation("files-only", [
      user("files", ""),
      assistant("pending", "empty-text"),
    ]);
    expect(nextPendingSend(conv)).toEqual({
      turnId: "empty-text",
      harness: "hermes",
      text: "",
      sessionId: undefined,
      cwd: undefined,
    });
  });

  test("two chats cannot borrow each other's text, harness, session or working directory", () => {
    const a = conversation("a", [user("a-user", "private a"), assistant("pending", "turn-a")], {
      harness: "omp",
      sessionId: "session-a",
      cwd: "/a",
    });
    const b = conversation("b", [user("b-user", "private b"), assistant("pending", "turn-b")], {
      harness: "hermes",
      sessionId: "session-b",
      cwd: "/b",
    });
    const expectedA = { turnId: "turn-a", harness: "omp", text: "private a", sessionId: "session-a", cwd: "/a" };
    const expectedB = { turnId: "turn-b", harness: "hermes", text: "private b", sessionId: "session-b", cwd: "/b" };

    expect(nextPendingSend(a)).toEqual(expectedA);
    expect(nextPendingSend(b)).toEqual(expectedB);
    const blockedB = conversation("b", [...b.messages, user("new", "running"), assistant("streaming", "live")], {
      harness: "hermes",
      sessionId: "session-b",
      cwd: "/b",
    });
    expect(nextPendingSend(blockedB)).toBeNull();
    expect(nextPendingSend(a)).toEqual(expectedA);
  });

  test("reading a parked payload never consumes, alters or strips its source attachments", () => {
    const attachments = [{
      id: "0123456789abcdef0123456789abcdef",
      name: "trace.txt",
      mime: "text/plain",
      size: 11,
    }];
    const draft = user("file-user", "inspect the attached trace", { attachments });
    const pending = assistant("pending", "file-turn", {
      text: "partial",
      status: "old status",
    });
    const conv = conversation("with-file", [draft, pending], {
      harness: "omp",
      sessionId: "session-files",
      cwd: "/project/files",
    });
    const snapshot = JSON.stringify(conv);
    Object.freeze(attachments[0]);
    Object.freeze(attachments);
    Object.freeze(draft);
    Object.freeze(pending);
    Object.freeze(conv.messages);
    Object.freeze(conv);

    const expected = {
      turnId: "file-turn",
      harness: "omp",
      text: "inspect the attached trace",
      sessionId: "session-files",
      cwd: "/project/files",
    };
    expect(nextPendingSend(conv)).toEqual(expected);
    expect(nextPendingSend(conv)).toEqual(expected);
    expect(JSON.stringify(conv)).toBe(snapshot);
    expect(draft.attachments).toBe(attachments);
    expect(draft.attachments).toEqual(attachments);
    expect(pending.state).toBe("pending");
    expect(pending.status).toBe("old status");
  });
});
