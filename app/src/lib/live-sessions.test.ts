import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostInfo } from "../../../shared/protocol";
import type { Conversation } from "../model";
import {
  conversationPreview,
  findLiveConversation,
  hydrateLiveConversation,
  liveConversationId,
  liveSessionTitle,
  mergeLiveConversations,
  shouldRequestHistory,
} from "./live-sessions";

const now = 1_700_000_000_000;

const liveOmp: HostInfo = {
  id: "mbp",
  name: "mbp",
  hostname: "mbp",
  online: true,
  self: true,
  agents: [
    {
      id: "omp:aaa",
      name: "OMP",
      kind: "omp",
      status: "running",
      detail: "/home/you/workspace/dash",
      cwd: "/home/you/workspace/dash",
      sessionId: "01liveomp",
    },
    {
      id: "harness:codex",
      name: "Codex",
      kind: "codex",
      status: "available",
    },
    {
      id: "cursor-cloud",
      name: "Cursor",
      kind: "cursor-cloud",
      status: "running",
      sessionId: "cursor-secret",
    },
  ],
};

const groot: HostInfo = {
  id: "0",
  name: "0",
  hostname: "groot",
  online: true,
  self: false,
  agents: [{ id: "hermes", name: "Hermes", kind: "hermes", status: "running", sessionId: "peer-sess" }],
};

describe("mergeLiveConversations", () => {
  test("a live OMP tab becomes a Conversation with harness omp and stable sessionId", () => {
    const conversations = mergeLiveConversations([], [liveOmp, groot], now);
    expect(conversations).toHaveLength(1);
    const chat = conversations[0]!;
    expect(chat.harness).toBe("omp");
    expect(chat.sessionId).toBe("01liveomp");
    expect(chat.id).toBe(liveConversationId("omp", "01liveomp"));
    expect(chat.title).toBe("dash");
    expect(chat.cwd).toBe("/home/you/workspace/dash");
    expect(chat.messages).toEqual([]);
  });

  test("opening the live row a second time does not mint another empty chat", () => {
    const first = mergeLiveConversations([], [liveOmp], now);
    const second = mergeLiveConversations(first, [liveOmp], now + 1);
    expect(second.filter((c) => c.sessionId === "01liveomp")).toHaveLength(1);
    expect(second).toBe(first);
    expect(findLiveConversation(second, { harness: "omp", sessionId: "01liveomp" })?.id).toBe(
      liveConversationId("omp", "01liveomp"),
    );
  });

  test("unknown harness ids fail closed even when they carry a sessionId", () => {
    const conversations = mergeLiveConversations([], [liveOmp], now);
    expect(conversations.some((c) => c.harness === "cursor-cloud")).toBe(false);
    expect(conversations.some((c) => c.sessionId === "cursor-secret")).toBe(false);
    expect(conversations.some((c) => c.sessionId === "peer-sess")).toBe(false);
  });

  test("keeps a phone-created chat that already owns the session", () => {
    const existing: Conversation[] = [
      {
        id: "phone-1",
        harness: "omp",
        title: "Ship chats",
        createdAt: now - 10,
        updatedAt: now - 10,
        sessionId: "01liveomp",
        messages: [{ id: "m1", role: "user", text: "hi", at: now - 10 }],
      },
    ];
    const merged = mergeLiveConversations(existing, [liveOmp], now);
    expect(merged).toBe(existing);
    expect(merged[0]?.id).toBe("phone-1");
  });

  test("still lists a live session when history is empty", () => {
    const [chat] = mergeLiveConversations([], [liveOmp], now);
    expect(chat).toBeDefined();
    expect(conversationPreview(chat!)).toBe("/home/you/workspace/dash");
    expect(liveSessionTitle({ name: "OMP", cwd: "/tmp/proj" })).toBe("proj");
  });

  test("hello hosts adopt live sessions in the app store", () => {
    const src = readFileSync(join(import.meta.dir, "../store/app.ts"), "utf8");
    expect(src).toContain("mergeLiveConversations");
    const pane = readFileSync(join(import.meta.dir, "../screens/panes/ChatsPane.tsx"), "utf8");
    expect(pane).toContain("conversationPreview");
    const chat = readFileSync(join(import.meta.dir, "../screens/ChatScreen.tsx"), "utf8");
    expect(chat).toContain("cwd: current.cwd");
  });

  test("a live OMP jsonl hydrates user and assistant turns after setActive", () => {
    const [listed] = mergeLiveConversations([], [liveOmp], now);
    expect(listed?.messages).toEqual([]);
    expect(shouldRequestHistory(listed)).toBe(true);
    const hydrated = hydrateLiveConversation(listed!, [
      { id: "u1", role: "user", text: "ship the live transcript", at: now - 20 },
      { id: "a1", role: "assistant", text: "opening the row shows this", at: now - 10 },
    ]);
    expect(hydrated.messages.map((m) => ({ role: m.role, text: m.text }))).toEqual([
      { role: "user", text: "ship the live transcript" },
      { role: "assistant", text: "opening the row shows this" },
    ]);
    expect(hydrated.sessionId).toBe("01liveomp");
    expect(conversationPreview(hydrated)).toBe("opening the row shows this");
    expect(hydrateLiveConversation(hydrated, [{ id: "u2", role: "user", text: "again", at: now }])).toBe(hydrated);
  });

  test("in-flight streaming turns keep attach; hydration does not mint a second chat", () => {
    const listed = mergeLiveConversations([], [liveOmp], now)[0]!;
    const streaming: Conversation = {
      ...listed,
      messages: [
        {
          id: "a-live",
          role: "assistant",
          text: "partial",
          at: now,
          state: "streaming",
          turnId: "turn-1",
          seq: 4,
        },
      ],
    };
    expect(shouldRequestHistory(streaming)).toBe(false);
    expect(
      hydrateLiveConversation(streaming, [{ id: "u1", role: "user", text: "hi", at: now }]),
    ).toBe(streaming);
    expect(shouldRequestHistory({ ...listed, harness: "cursor-cloud", sessionId: "cursor-secret" })).toBe(false);
  });

  test("setActive requests live history over the existing socket", () => {
    const app = readFileSync(join(import.meta.dir, "../store/app.ts"), "utf8");
    expect(app).toContain("hydrateLiveConversation");
    expect(app).toContain("applyLiveHistory");
    expect(app).toContain("shouldRequestHistory");
    const bridge = readFileSync(join(import.meta.dir, "../net/bridge.ts"), "utf8");
    expect(bridge).toContain('type: "history"');
    expect(bridge).toContain("applyLiveHistory");
    expect(bridge).not.toContain("cursor-cloud");
  });
});
