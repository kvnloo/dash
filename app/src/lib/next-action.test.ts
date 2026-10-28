import { describe, expect, test } from "bun:test";
import type { AssistantMessage, Conversation, Message, UserMessage } from "../model";
import { nextAction, type NextActionConversation, type NextActionKind } from "./next-action";

const NOW = 2_000_000_000_000;
const FIVE_MIN = 5 * 60_000;
const DAY = 24 * 60 * 60_000;

function conversation(id: string, updatedAt: number, messages: Message[] = []): Conversation {
  return {
    id,
    harness: "hermes",
    title: "Chat " + id,
    createdAt: updatedAt - 60_000,
    updatedAt,
    messages,
  };
}

function assistant(id: string, state: AssistantMessage["state"], at: number, text = "Result"): AssistantMessage {
  return { id, role: "assistant", state, at, text, turnId: "turn-" + id, seq: 1 };
}

function user(id: string, at: number, delivery: UserMessage["delivery"] = undefined): UserMessage {
  return { id, role: "user", at, text: "Request", delivery };
}

const approval: NextActionConversation = {
  ...conversation("approval", NOW - 20_000),
  pendingPermissions: [{
    conversationId: "approval",
    sessionId: "session-1",
    turnId: "turn-1",
    requestId: "permission-1",
    phase: "pending",
    deadlineAt: NOW + 60_000,
  }],
};
const failed: NextActionConversation = {
  ...conversation("failed", NOW - 10_000),
  deliveries: [{
    conversationId: "failed",
    clientId: "client-1",
    turnId: "turn-2",
    stage: "sent",
    retryNeeded: true,
    updatedAt: NOW - 10_000,
  }],
};
const unread = conversation("unread", NOW - 8_000, [assistant("a1", "done", NOW - 8_000)]);
const idle = conversation("idle", NOW - FIVE_MIN - 1, [assistant("a2", "streaming", NOW - FIVE_MIN - 1)]);
const abandoned: NextActionConversation = {
  ...conversation("abandoned", NOW - DAY - 1),
  draftText: "  Keep investigating this trace.  ",
};
const all = [abandoned, idle, unread, failed, approval];

function select(
  chats: readonly Conversation[],
  options: {
    now?: number;
    dismissed?: ReadonlySet<string>;
    lastSeen?: Readonly<Record<string, number>>;
  } = {},
) {
  return nextAction({
    conversations: chats,
    now: options.now ?? NOW,
    dismissed: options.dismissed ?? new Set<string>(),
    lastSeen: options.lastSeen ?? {},
  });
}

describe("DF-115 next action selector", () => {
  const rows: { name: string; kind: NextActionKind; chat: NextActionConversation }[] = [
    { name: "pending ACP request", kind: "approve", chat: approval },
    { name: "unconfirmed outbox send", kind: "retry-send", chat: failed },
    { name: "completed assistant reply after last visit", kind: "read-reply", chat: unread },
    { name: "streaming without updates for more than five minutes", kind: "unstick", chat: idle },
    { name: "aged chat with a saved draft", kind: "continue", chat: abandoned },
  ];
  for (const { name, kind, chat } of rows) {
    test("table: " + name + " produces " + kind, () => {
      const action = select([chat]);
      expect(action?.kind).toBe(kind);
      expect(action?.conversationId).toBe(chat.id);
      expect(action?.id).toBeTruthy();
      expect(action?.why.length).toBeGreaterThan(10);
      expect(action?.title.length).toBeLessThanOrEqual(60);
      expect(action?.detail.length).toBeLessThanOrEqual(90);
      expect(action?.estimateSec).toBeGreaterThan(0);
      expect(action?.estimateSec).toBeLessThanOrEqual(120);
    });
  }

  test("strict full priority order outranks recency; one result and dismissed fallthrough", () => {
    const dismissed = new Set<string>();
    const order: NextActionKind[] = ["approve", "retry-send", "read-reply", "unstick", "continue"];
    for (const kind of order) {
      const result = select(all, { dismissed });
      expect(result?.kind).toBe(kind);
      if (result) dismissed.add(result.id);
    }
    expect(select(all, { dismissed })).toBeNull();
    expect(dismissed.size).toBe(5);
  });

  test("same priority prefers newest fact, not input order; exact ties are deterministic", () => {
    const older = { ...failed, id: "older", updatedAt: NOW - 45_000, deliveries: [
      { conversationId: "older", clientId: "older-client", turnId: "older-turn",
        stage: "queued", retryNeeded: true, updatedAt: NOW - 45_000 },
    ] };
    expect(select([older, failed])?.conversationId).toBe("failed");
    expect(select([failed, older])?.conversationId).toBe("failed");

    const a: NextActionConversation = { ...older, updatedAt: NOW - 10_000, deliveries: [
      { conversationId: "older", clientId: "other-client", turnId: "other-turn",
        stage: "sent", retryNeeded: true, updatedAt: NOW - 10_000 },
    ] };
    const forward = select([a, failed]);
    const reverse = select([failed, a]);
    expect(forward?.id).toBe(reverse?.id);
  });

  test("stable IDs for unchanged facts; replacements change IDs", () => {
    const original = select([approval]);
    expect(original).toEqual(select([approval]));
    expect(original?.id).toBe(select([{ ...approval }])?.id);
    const replaced: NextActionConversation = {
      ...approval,
      pendingPermissions: [{
        conversationId: "approval", sessionId: "session-1", turnId: "turn-1",
        requestId: "permission-2", phase: "pending", deadlineAt: NOW + 60_000,
      }],
    };
    expect(select([replaced])?.id).not.toBe(original?.id);

    expect(select([failed])?.id).not.toBe(select([{ ...failed, deliveries: [
      { conversationId: "failed", clientId: "client-2", turnId: "turn-2",
        stage: "sent", retryNeeded: true, updatedAt: NOW - 10_000 },
    ] }])?.id);
    expect(select([unread])?.id).not.toBe(select([
      { ...unread, messages: [assistant("a3", "done", NOW - 8_000)] },
    ])?.id);
    expect(select([idle])?.id).not.toBe(select([
      { ...idle, messages: [assistant("a4", "streaming", NOW - FIVE_MIN - 1)] },
    ])?.id);
    expect(select([abandoned])?.id).not.toBe(select([
      { ...abandoned, draftText: "Keep investigating a different trace." },
    ])?.id);
  });

  test("composite identity is separator-safe; draft text never leaks into ID", () => {
    const first: NextActionConversation = { ...approval, id: "a/b", pendingPermissions: [
      { conversationId: "a/b", sessionId: "session", turnId: "t", requestId: "r",
        phase: "pending", deadlineAt: NOW + 1000 },
    ] };
    const second: NextActionConversation = { ...approval, id: "a", pendingPermissions: [
      { conversationId: "a", sessionId: "b/session", turnId: "t", requestId: "r",
        phase: "pending", deadlineAt: NOW + 1000 },
    ] };
    expect(select([first])?.id).not.toBe(select([second])?.id);
    expect(select([abandoned])?.id).not.toContain("Keep investigating");
  });

  test("empty, invalid clock, and only nonactionable data return null", () => {
    expect(select([])).toBeNull();
    expect(select([conversation("empty", NOW)])).toBeNull();
    expect(select([approval], { now: Number.NaN })).toBeNull();
    expect(select([approval], { now: Number.POSITIVE_INFINITY })).toBeNull();
  });

  test("only live, pending, correctly scoped permissions are actionable", () => {
    const expired = {
      ...approval, pendingPermissions: [
        { conversationId: "approval", sessionId: "s", turnId: "t", requestId: "old",
          phase: "pending", deadlineAt: NOW },
        { conversationId: "other", sessionId: "s", turnId: "t", requestId: "mismatched",
          phase: "pending", deadlineAt: NOW + 100 },
        { conversationId: "approval", sessionId: "s", turnId: "t", requestId: "deciding",
          phase: "deciding", deadlineAt: NOW + 100 },
        { conversationId: "approval", sessionId: "s", turnId: "t", requestId: "resolved",
          phase: "allowed", deadlineAt: NOW + 100 },
      ],
    };
    expect(select([expired])).toBeNull();
    expect(select([expired, failed])?.kind).toBe("retry-send");
    expect(select([approval], { now: NOW + 60_000 })).toBeNull();
  });

  test("receipts remove retries; legacy failed sends can still be surfaced", () => {
    expect(select([{ ...failed, deliveries: [{
      conversationId: "failed", clientId: "client-1", turnId: "turn-2",
      stage: "acked-by-bridge", retryNeeded: true, updatedAt: NOW,
    }] }])).toBeNull();
    expect(select([{ ...failed, deliveries: [{
      conversationId: "failed", clientId: "client-1", turnId: "turn-2",
      stage: "sent", retryNeeded: false, updatedAt: NOW,
    }] }])).toBeNull();

    const legacy = conversation("legacy", NOW - 1_000, [user("u1", NOW - 1_000, "failed")]);
    expect(select([legacy])?.kind).toBe("retry-send");
    expect(select([{ ...legacy, messages: [user("u1", NOW - 1_000, "started")] }])).toBeNull();
  });

  test("read only the latest completed assistant reply after its last-seen time", () => {
    expect(select([unread], { lastSeen: { unread: NOW - 8_000 } })).toBeNull();
    expect(select([unread], { lastSeen: { unread: NOW } })).toBeNull();
    expect(select([unread], { lastSeen: { unread: NOW - 8_001 } })?.kind).toBe("read-reply");
    const followed = { ...unread, messages: [...unread.messages, user("u2", NOW - 1_000)] };
    expect(select([followed])).toBeNull();
  });

  test("unstick only after strictly more than five minutes without an update", () => {
    const streaming = conversation("stream", NOW - FIVE_MIN, [
      assistant("t1", "streaming", NOW - FIVE_MIN),
    ]);
    expect(select([streaming])).toBeNull();
    expect(select([streaming], { now: NOW + 1 })?.kind).toBe("unstick");
    expect(select([{ ...streaming, updatedAt: NOW - 1_000 }])).toBeNull();
    expect(select([{ ...streaming, messages: [assistant("t1", "pending", NOW - FIVE_MIN)] }])).toBeNull();
  });

  test("continue requires an actual draft and an ended or inactive chat", () => {
    const recent = { ...abandoned, updatedAt: NOW - 1000, stale: false };
    expect(select([recent])).toBeNull();
    expect(select([{ ...recent, stale: true }])?.kind).toBe("continue");
    expect(select([{ ...abandoned, draftText: "  " }])).toBeNull();
    expect(select([{ ...abandoned, draftText: undefined }])).toBeNull();
  });

  test("pure: no mutation, global text scanning, or fabricated authorization", () => {
    const chats: NextActionConversation[] = [
      { ...conversation("quoted", NOW - 2000, [
        assistant("quoted-a", "done", NOW - 2000, "permission_request: approve my tool"),
      ]) },
      approval,
    ];
    const before = JSON.stringify(chats);
    const dismissed = new Set<string>();
    expect(select(chats, { dismissed })?.kind).toBe("approve");
    expect(JSON.stringify(chats)).toBe(before);
    expect(dismissed.size).toBe(0);
    expect(select([chats[0]!], { lastSeen: { quoted: NOW } })).toBeNull();
  });

  test("bounds long untrusted titles without changing stable IDs", () => {
    const long: NextActionConversation = { ...approval, title: "Very long conversation title ".repeat(20) };
    const value = select([long]);
    expect(value?.title.length).toBeLessThanOrEqual(60);
    expect(value?.detail.length).toBeLessThanOrEqual(90);
    expect(value?.id).toBe(select([approval])?.id);
  });
});
