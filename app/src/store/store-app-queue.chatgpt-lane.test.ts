import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { spawnSync } from "node:child_process";
import type { ChatAttachment } from "../../../shared/protocol";
import type { Conversation, Message } from "../model";
import type { AppState, ChatSender } from "./app";

// app.ts imports native AsyncStorage. Running its mock in a separate Bun test
// process prevents mock.module from replacing the module in sibling test files.
if (process.env.DASH2_QUEUE_TEST_CHILD !== "1") {
  test("queue store contracts execute with isolated native-storage mocks", () => {
    const child = spawnSync(process.execPath, ["test", import.meta.path], {
      env: { ...process.env, DASH2_QUEUE_TEST_CHILD: "1" },
      encoding: "utf8",
      timeout: 60_000,
    });
    if (child.error) throw child.error;
    if (child.status !== 0) {
      throw new Error(
        "Isolated queue store tests failed (exit " + String(child.status) + ")\n" +
        child.stdout + "\n" + child.stderr,
      );
    }
    expect(child.status).toBe(0);
  });
} else {
  const persisted = new Map<string, string>();
  mock.module("@react-native-async-storage/async-storage", () => ({
    default: {
      async multiGet(keys: string[]): Promise<Array<[string, string | null]>> {
        return keys.map((key): [string, string | null] => [key, persisted.get(key) ?? null]);
      },
      async multiSet(entries: Array<[string, string]>): Promise<void> {
        for (const [key, value] of entries) persisted.set(key, value);
      },
      async setItem(key: string, value: string): Promise<void> {
        persisted.set(key, value);
      },
      async multiRemove(keys: string[]): Promise<void> {
        for (const key of keys) persisted.delete(key);
      },
    },
  }));

  const app = await import("./app");
  const { queuedParts, queueMergeError } = await import("../lib/pending-queue");

  function cleanState(): AppState {
    return {
      hydrated: true,
      settings: null,
      connection: { status: "online", harnesses: [], hosts: [] },
      conversations: [],
      activeId: null,
    };
  }

  beforeEach(() => {
    persisted.clear();
    app.store.set(cleanState());
  });

  afterEach(async () => {
    // Let app.ts's debounced persistence flush before the next synthetic chat.
    await new Promise<void>((resolve) => setTimeout(resolve, 450));
    app.store.set(cleanState());
    persisted.clear();
  });

  function attachment(number: number): ChatAttachment {
    return {
      id: number.toString(16).padStart(32, "0"),
      name: "fixture-" + number + ".txt",
      mime: "text/plain",
      size: number + 1,
    };
  }

  function historyPair(chatId: string, number: number): Message[] {
    return [
      {
        id: chatId + "-history-u-" + number,
        role: "user",
        text: "old prompt " + number,
        at: number + 1,
      },
      {
        id: chatId + "-history-a-" + number,
        role: "assistant",
        text: "old answer " + number,
        at: number + 1,
        state: "done",
        turnId: chatId + "-done-" + number,
        seq: 1,
      },
    ];
  }

  function pendingPair(chatId: string, number: number, files: ChatAttachment[]): Message[] {
    return [
      {
        id: chatId + "-queued-u-" + number,
        role: "user",
        text: "pending " + number,
        at: number + 100,
        delivery: "queued",
        ...(files.length ? { attachments: files } : {}),
      },
      {
        id: chatId + "-queued-a-" + number,
        role: "assistant",
        text: "",
        at: number + 100,
        state: "pending",
        turnId: chatId + "-turn-" + number,
        seq: 0,
      },
    ];
  }

  function seed(chatId = "primary", fileCounts: readonly [number, number, number] = [1, 2, 1]): Conversation {
    const files = (number: number, count: number) =>
      Array.from({ length: count }, (_, index) => attachment(number * 10 + index));
    const conversation: Conversation = {
      id: chatId,
      harness: "hermes",
      title: "Queue fixture",
      createdAt: 1,
      updatedAt: 1,
      messages: [
        ...historyPair(chatId, 1),
        ...pendingPair(chatId, 1, files(1, fileCounts[0])),
        ...historyPair(chatId, 2),
        ...pendingPair(chatId, 2, files(2, fileCounts[1])),
        ...pendingPair(chatId, 3, files(3, fileCounts[2])),
      ],
    };
    app.store.set((state) => ({
      ...state,
      conversations: [conversation, ...state.conversations],
      activeId: chatId,
    }));
    return conversation;
  }

  function current(chatId: string): Conversation {
    const conversation = app.store.get().conversations.find((item) => item.id === chatId);
    if (!conversation) throw new Error("Missing fixture conversation: " + chatId);
    return conversation;
  }

  function pairIds(chatId: string): Array<[string, string, string]> {
    return queuedParts(current(chatId)).map((part) => [
      part.user.id,
      part.assistant.id,
      part.assistant.turnId,
    ]);
  }

  function history(chatId: string): Message[] {
    return current(chatId).messages.filter((message) => message.id.includes("-history-"));
  }

  describe("queue edits and deletes retain history and exact pair identities", () => {
    test("editQueued edits only the named pending user, not history or another conversation", () => {
      const original = seed();
      seed("secondary");
      const before = original.messages;
      app.editQueued(original.id, "primary-turn-2", "rewritten second prompt");
      app.editQueued(original.id, "primary-done-2", "must not touch history");
      app.editQueued(original.id, "missing-turn", "must not touch queue");
      app.editQueued("secondary", "primary-turn-1", "must not touch another chat");

      expect(queuedParts(current(original.id)).map((part) => part.user.text)).toEqual([
        "pending 1", "rewritten second prompt", "pending 3",
      ]);
      expect(current(original.id).messages.find((message) => message.id === "primary-queued-u-2"))
        .toMatchObject({ id: "primary-queued-u-2", role: "user", text: "rewritten second prompt", delivery: "queued" });
      expect(current(original.id).messages.find((message) => message.id === "primary-queued-a-2"))
        .toBe(before.find((message) => message.id === "primary-queued-a-2"));
      for (const message of before.filter((item) => item.id.includes("-history-") || item.id.includes("-queued-u-1") || item.id.includes("-queued-u-3"))) {
        expect(current(original.id).messages.find((item) => item.id === message.id)).toBe(message);
      }
      expect(queuedParts(current("secondary")).map((part) => part.user.text)).toEqual([
        "pending 1", "pending 2", "pending 3",
      ]);
    });

    test("removeQueued deletes one exact pair; clearing deletes no historical pairs", () => {
      const conversation = seed();
      const historic = history(conversation.id);
      const initial = pairIds(conversation.id);
      const firstPair = initial[0];
      const thirdPair = initial[2];
      if (!firstPair || !thirdPair) throw new Error("Expected three initial queued pairs");
      app.removeQueued(conversation.id, "primary-turn-2");
      expect(pairIds(conversation.id)).toEqual([firstPair, thirdPair]);
      expect(current(conversation.id).messages.some((message) => message.id === "primary-queued-u-2")).toBe(false);
      expect(current(conversation.id).messages.some((message) => message.id === "primary-queued-a-2")).toBe(false);
      for (const message of historic) {
        expect(current(conversation.id).messages.find((item) => item.id === message.id)).toBe(message);
      }

      const afterOne = current(conversation.id).messages;
      app.removeQueued(conversation.id, "primary-done-1");
      expect(current(conversation.id).messages).toEqual(afterOne);
      app.setQueueWaiting(conversation.id, true);
      app.removeQueued(conversation.id);
      expect(pairIds(conversation.id)).toEqual([]);
      expect(current(conversation.id).messages).toEqual(historic);
      expect(current(conversation.id).queueWaitForIdle).toBe(false);
    });
  });

  describe("queue reordering preserves pair adjacency and attachment ownership", () => {
    test("moving either end rearranges only pending pairs; invalid indices are identity no-ops", () => {
      const conversation = seed();
      const historic = history(conversation.id);
      const beforeParts = queuedParts(current(conversation.id));
      const beforeIds = pairIds(conversation.id);
      const [firstPair, secondPair, thirdPair] = beforeIds;
      if (!firstPair || !secondPair || !thirdPair) throw new Error("Expected three queued pairs");

      app.moveQueued(conversation.id, 0, 2);
      expect(pairIds(conversation.id)).toEqual([secondPair, thirdPair, firstPair]);
      expect(queuedParts(current(conversation.id)).map((part) => part.user.attachments)).toEqual([
        beforeParts[1]?.user.attachments, beforeParts[2]?.user.attachments, beforeParts[0]?.user.attachments,
      ]);
      for (const message of historic) {
        expect(current(conversation.id).messages.find((item) => item.id === message.id)).toBe(message);
      }

      const invalidMoves: ReadonlyArray<readonly [number, number]> = [
        [-1, 0], [0, -1], [3, 0], [0, 3], [0, 0], [1.5, 2], [0, Number.NaN], [Infinity, 1],
      ];
      for (const [from, to] of invalidMoves) {
        const prior = app.store.get();
        app.moveQueued(conversation.id, from, to);
        expect(app.store.get()).toBe(prior);
      }
      app.moveQueued(conversation.id, 2, 0);
      expect(pairIds(conversation.id)).toEqual(beforeIds);
    });

    test("reordered steer consumes exactly once with ordered text and attachments", () => {
      const conversation = seed();
      const parts = queuedParts(current(conversation.id));
      const historic = history(conversation.id);
      app.moveQueued(conversation.id, 2, 0);
      expect(app.takeQueuedForSteer(conversation.id)).toEqual({
        text: "pending 3\n\npending 1\n\npending 2",
        attachments: [
          ...(parts[2]?.user.attachments ?? []),
          ...(parts[0]?.user.attachments ?? []),
          ...(parts[1]?.user.attachments ?? []),
        ],
      });
      expect(app.takeQueuedForSteer(conversation.id)).toBeUndefined();
      expect(current(conversation.id).messages).toEqual(historic);
    });
  });

  describe("queue previews gate delivery and preserve the durable pairs", () => {
    test("unsaved preview blocks flush and steer; cancel preserves every original id and attachment", () => {
      const conversation = seed();
      const priorMessages = current(conversation.id).messages;
      const priorIds = pairIds(conversation.id);
      app.previewQueued(conversation.id);
      expect(current(conversation.id).queuePreview).toBe("pending 1\n\npending 2\n\npending 3");
      app.changeQueuePreview(conversation.id, "edited draft");
      let sends = 0;
      const send: ChatSender = () => { sends++; return true; };
      expect(app.flushPendingSends(send)).toBe(0);
      expect(app.takeQueuedForSteer(conversation.id)).toBeUndefined();
      expect(sends).toBe(0);
      expect(current(conversation.id).messages).toEqual(priorMessages);
      app.cancelQueuePreview(conversation.id);
      expect(current(conversation.id).queuePreview).toBeUndefined();
      expect(current(conversation.id).messages).toEqual(priorMessages);
      expect(pairIds(conversation.id)).toEqual(priorIds);
    });

    test("blank save never replaces queue; changing without preview cannot create one", () => {
      const conversation = seed();
      const messages = current(conversation.id).messages;
      app.changeQueuePreview(conversation.id, "uninvited");
      expect(current(conversation.id).queuePreview).toBeUndefined();

      app.previewQueued(conversation.id);
      app.changeQueuePreview(conversation.id, " \n \t ");
      app.saveQueuePreview(conversation.id);
      expect(current(conversation.id).queuePreview).toBe(" \n \t ");
      expect(current(conversation.id).messages).toEqual(messages);
      expect(app.flushPendingSends(() => { throw new Error("blank preview sent"); })).toBe(0);
      app.cancelQueuePreview(conversation.id);
      expect(pairIds(conversation.id)).toHaveLength(3);
    });

    test("saving trimmed preview merges once with first turn id and all attachments in original order", () => {
      const conversation = seed();
      const before = queuedParts(current(conversation.id));
      const historic = history(conversation.id);
      const first = before[0];
      if (!first) throw new Error("Missing first queued pair");

      app.previewQueued(conversation.id);
      app.changeQueuePreview(conversation.id, "  consolidated request \n");
      app.saveQueuePreview(conversation.id);
      expect(current(conversation.id).queuePreview).toBeUndefined();
      expect(pairIds(conversation.id)).toEqual([[first.user.id, first.assistant.id, first.assistant.turnId]]);
      expect(queuedParts(current(conversation.id))[0]?.user).toMatchObject({
        text: "consolidated request",
        attachments: before.flatMap((part) => part.user.attachments ?? []),
      });
      for (const message of historic) {
        expect(current(conversation.id).messages.find((item) => item.id === message.id)).toBe(message);
      }

      const afterSave = current(conversation.id).messages;
      app.saveQueuePreview(conversation.id);
      expect(current(conversation.id).messages).toEqual(afterSave);
      const sent: Array<Parameters<ChatSender>[0]> = [];
      expect(app.flushPendingSends((input) => { sent.push(input); return true; })).toBe(1);
      expect(sent).toEqual([{
        turnId: first.assistant.turnId,
        harness: "hermes",
        text: "consolidated request",
        sessionId: undefined,
        cwd: undefined,
        attachments: before.flatMap((part) => part.user.attachments ?? []),
      }]);
      expect(app.flushPendingSends(() => { throw new Error("duplicate dispatch"); })).toBe(0);
    });

    test("too many combined attachments prevents preview, steer and combined delivery", () => {
      const conversation = seed("overflow", [4, 3, 2]);
      const messages = current(conversation.id).messages;
      expect(queueMergeError(current(conversation.id))).toContain("Over 8 attachments");
      app.previewQueued(conversation.id);
      app.changeQueuePreview(conversation.id, "must not bypass error");
      app.saveQueuePreview(conversation.id);
      expect(current(conversation.id).queuePreview).toBeUndefined();
      expect(current(conversation.id).messages).toEqual(messages);
      expect(app.takeQueuedForSteer(conversation.id)).toBeUndefined();
      expect(app.flushPendingSends(() => { throw new Error("incompatible merge sent"); })).toBe(0);

      // Opting out of combined delivery is permitted: each individual turn fits.
      app.setDeliverQueuedAsOne(conversation.id, false);
      const sent: Array<Parameters<ChatSender>[0]> = [];
      expect(app.flushPendingSends((input) => { sent.push(input); return true; })).toBe(1);
      expect(sent[0]?.turnId).toBe("overflow-turn-1");
      expect(sent[0]?.attachments).toHaveLength(4);
      expect(pairIds(conversation.id)).toHaveLength(2);
    });

    test("late ninth attachment must not be merged through an already-open preview (producer regression)", () => {
      const conversation = seed("late", [4, 4, 0]);
      app.previewQueued(conversation.id);
      expect(current(conversation.id).queuePreview).toBeDefined();
      const added = app.beginTurn(conversation.id, "ninth file", {
        pending: true,
        attachments: [attachment(99)],
      });
      expect(queueMergeError(current(conversation.id))).toContain("Over 8 attachments");

      app.saveQueuePreview(conversation.id);
      // Until the attachment error is resolved, the preview and all four
      // pending pairs must stay intact. Current app.ts combines them anyway.
      expect(current(conversation.id).queuePreview).toBeDefined();
      expect(pairIds(conversation.id)).toHaveLength(4);
      expect(current(conversation.id).messages.find((message) => message.id === added.messageId))
        .toMatchObject({ state: "pending", turnId: added.turnId });
    });
  });
}
