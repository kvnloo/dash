import { describe, expect, test } from "bun:test";
import { MAX_ATTACHMENTS_PER_TURN } from "../../../shared/protocol";
import type { AssistantMessage, Conversation, Message, UserMessage } from "../model";
import { combineQueued, mergedQueue, queueMergeError, queuedParts, reorderQueued } from "./pending-queue";

/**
 * Optional local timing recipe (NOT RUN):
 * Input: makeConversation(2_048), with 2,048 pending pairs, finished-history
 * interleaves, orphan pending assistants and a dangling user message.
 * Run five separate repetitions of:
 *   /usr/bin/time -p bun test app/src/lib/pending-queue.performance-lane.test.ts
 * Record Bun version, OS, CPU and the five process-level elapsed times.
 * Process time includes Bun startup and assertions: do not call it helper latency.
 * Baseline timings: NOT RUN. Candidate timings: NOT RUN. Device: NOT RUN.
 * No elapsed-time or arbitrary heap budgets are asserted in the tests.
 */

function attachmentId(index: number): string {
  return index.toString(16).padStart(32, "0");
}

function appendHistory(messages: Message[], index: number): void {
  messages.push(
    { id: "history-user-" + index, role: "user", text: "saved user " + index, at: 1 },
    { id: "history-assistant-" + index, role: "assistant", text: "saved answer " + index, at: 2, state: "done", turnId: "history-turn-" + index, seq: 7 },
    // A pending assistant without an immediately preceding user is not a queued pair.
    { id: "orphan-" + index, role: "assistant", text: "", at: 3, state: "pending", turnId: "orphan-turn-" + index, seq: 0 },
  );
}

/** Frozen input: a regression that mutates the queue or any history object throws. */
function makeConversation(count: number, attachmentIndexes: ReadonlySet<number> = new Set<number>()): Conversation {
  const messages: Message[] = [];
  appendHistory(messages, -1);
  messages.push({ id: "running", role: "assistant", text: "in progress", at: 3, state: "streaming", turnId: "running-turn", seq: 1 });
  for (let index = 0; index < count; index++) {
    if (index > 0 && index % 37 === 0) appendHistory(messages, index);
    const user: UserMessage = {
      id: "queue-user-" + index,
      role: "user",
      text: "prompt-" + index,
      at: 10 + index,
      ...(attachmentIndexes.has(index) ? {
        attachments: [{ id: attachmentId(index), name: "attachment-" + index + ".txt", mime: "text/plain", size: index + 1 }],
      } : {}),
    };
    const assistant: AssistantMessage = {
      id: "queue-assistant-" + index,
      role: "assistant",
      text: "",
      at: 10 + index,
      state: "pending",
      turnId: "queued-turn-" + index,
      seq: 0,
    };
    messages.push(user, assistant);
  }
  messages.push({ id: "dangling-user", role: "user", text: "not queued", at: 20_000 });
  const conversation: Conversation = {
    id: "synthetic", harness: "hermes", title: "Synthetic queue",
    createdAt: 1, updatedAt: 2, sessionId: "session-1",
    targetHostId: "target-host", profileId: "profile-1", cwd: "/work",
    queuePreview: "unsaved preview", queueWaitForIdle: true,
    deliverQueuedAsOne: false, messages,
  };
  for (const message of messages) {
    if (message.role === "user" && message.attachments) {
      for (const attachment of message.attachments) Object.freeze(attachment);
      Object.freeze(message.attachments);
    }
    Object.freeze(message);
  }
  Object.freeze(messages);
  Object.freeze(conversation);
  return conversation;
}

function isUnrelated(message: Message): boolean {
  return !message.id.startsWith("queue-user-") && !message.id.startsWith("queue-assistant-");
}

/** Count observable indexed reads; catch accidental repeated full-array searches. */
function countIndexedReads(source: Conversation): { input: Conversation; reads: () => number } {
  let count = 0;
  const messages = new Proxy(source.messages, {
    get(target, property, receiver) {
      if (typeof property === "string" && /^(0|[1-9][0-9]*)$/.test(property)) count++;
      return Reflect.get(target, property, receiver);
    },
  });
  return { input: { ...source, messages }, reads: () => count };
}

describe("pending queue output and operation guards", () => {
  test("small inputs pair only adjacent pending replies, retaining all other messages", () => {
    const input = makeConversation(3, new Set([0, 2]));
    const parts = queuedParts(input);
    expect(parts.map(part => [part.user.id, part.assistant.id, part.assistant.turnId])).toEqual([
      ["queue-user-0", "queue-assistant-0", "queued-turn-0"],
      ["queue-user-1", "queue-assistant-1", "queued-turn-1"],
      ["queue-user-2", "queue-assistant-2", "queued-turn-2"],
    ]);
    expect(mergedQueue(parts)).toBe("prompt-0\n\nprompt-1\n\nprompt-2");
    for (const part of parts) {
      expect(input.messages[input.messages.indexOf(part.user) + 1]).toBe(part.assistant);
    }

    const reordered = reorderQueued(input, 2, 0);
    expect(queuedParts(reordered).map(part => [part.user.id, part.assistant.turnId])).toEqual([
      ["queue-user-2", "queued-turn-2"],
      ["queue-user-0", "queued-turn-0"],
      ["queue-user-1", "queued-turn-1"],
    ]);
    for (const [index, message] of input.messages.entries()) {
      if (isUnrelated(message)) expect(reordered.messages[index]).toBe(message);
    }
    expect(reordered.targetHostId).toBe(input.targetHostId);
    expect(reordered.queuePreview).toBe(input.queuePreview);
    expect(queuedParts(input).map(part => part.user.id)).toEqual(["queue-user-0", "queue-user-1", "queue-user-2"]);

    const combined = combineQueued(input);
    expect(combined.messages).toHaveLength(input.messages.length - 4);
    expect(queuedParts(combined).map(part => [part.user.id, part.assistant.id])).toEqual([
      ["queue-user-0", "queue-assistant-0"],
    ]);
    expect(queuedParts(combined)[0]?.user.text).toBe("prompt-0\n\nprompt-1\n\nprompt-2");
    expect(queuedParts(combined)[0]?.user.attachments?.map(file => file.id)).toEqual([attachmentId(0), attachmentId(2)]);
    expect(combined.queuePreview).toBeUndefined();
    expect(combined.targetHostId).toBe(input.targetHostId);
    expect(combined.sessionId).toBe(input.sessionId);
    expect(combined.queueWaitForIdle).toBe(true);
    expect(combined.deliverQueuedAsOne).toBe(false);
    for (const original of input.messages.filter(isUnrelated)) {
      expect(combined.messages.find(message => message.id === original.id)).toBe(original);
    }
    expect(input.queuePreview).toBe("unsaved preview");
    expect(queuedParts(input)).toHaveLength(3);
  });

  test("2,048 pairs keep identities, indices, history and attachments under reorder and merge", () => {
    const size = 2_048;
    const attachmentIndexes = [0, size / 2, size - 1];
    const input = makeConversation(size, new Set(attachmentIndexes));
    const originalMessages = input.messages.slice();
    const parts = queuedParts(input);
    expect(parts).toHaveLength(size);
    expect(parts.map(part => [part.user.id, part.assistant.turnId])).toEqual(
      Array.from({ length: size }, (_, i) => ["queue-user-" + i, "queued-turn-" + i]),
    );
    const expectedText = Array.from({ length: size }, (_, i) => "prompt-" + i).join("\n\n");
    expect(mergedQueue(parts)).toBe(expectedText);

    const moved = reorderQueued(input, size - 1, 0);
    const movedParts = queuedParts(moved);
    expect(movedParts.map(part => [part.user.id, part.assistant.turnId])).toEqual(
      [size - 1, ...Array.from({ length: size - 1 }, (_, i) => i)]
        .map(i => ["queue-user-" + i, "queued-turn-" + i]),
    );
    const originalsById = new Map(input.messages.map(message => [message.id, message]));
    for (const part of movedParts) {
      expect(part.user).toBe(originalsById.get(part.user.id));
      expect(part.assistant).toBe(originalsById.get(part.assistant.id));
      expect(moved.messages[moved.messages.indexOf(part.user) + 1]).toBe(part.assistant);
    }
    for (const [index, message] of input.messages.entries()) {
      if (isUnrelated(message)) expect(moved.messages[index]).toBe(message);
    }
    expect(moved.queuePreview).toBe("unsaved preview");

    const combined = combineQueued(input);
    expect(combined.messages).toHaveLength(input.messages.length - 2 * (size - 1));
    const merged = queuedParts(combined);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.user.id).toBe("queue-user-0");
    expect(merged[0]?.assistant).toBe(parts[0]?.assistant);
    expect(merged[0]?.user.text).toBe(expectedText);
    expect(merged[0]?.user.attachments?.map(file => file.id)).toEqual(attachmentIndexes.map(attachmentId));
    for (const original of input.messages.filter(isUnrelated)) {
      expect(combined.messages.find(message => message.id === original.id)).toBe(original);
    }
    expect(combined.queuePreview).toBeUndefined();
    expect(combined.targetHostId).toBe("target-host");
    expect(input.messages).toEqual(originalMessages);
    expect(queuedParts(input)).toHaveLength(size);
  });

  test("source attachment cap rejects overflow without dropping or rearranging references", () => {
    const indexes = Array.from({ length: MAX_ATTACHMENTS_PER_TURN }, (_, index) => index);
    const atCap = makeConversation(indexes.length, new Set(indexes));
    expect(queueMergeError(atCap)).toBeUndefined();
    expect(queuedParts(combineQueued(atCap))[0]?.user.attachments?.map(file => file.id)).toEqual(indexes.map(attachmentId));

    const overflowIndexes = [...indexes, MAX_ATTACHMENTS_PER_TURN];
    const overflow = makeConversation(overflowIndexes.length, new Set(overflowIndexes));
    expect(queueMergeError(overflow)).toBe("Over 8 attachments: remove messages or turn off combined delivery.");
    // The pure transformer remains lossless; the caller decides whether the cap blocks sending.
    expect(queuedParts(combineQueued(overflow))[0]?.user.attachments?.map(file => file.id)).toEqual(overflowIndexes.map(attachmentId));
    expect(queuedParts(overflow)).toHaveLength(overflowIndexes.length);
  });

  test("empty queues and all invalid moves are identity-preserving no-ops", () => {
    const empty = makeConversation(0);
    expect(queuedParts(empty)).toEqual([]);
    expect(queueMergeError(empty)).toBeUndefined();
    expect(combineQueued(empty)).toBe(empty);
    expect(reorderQueued(empty, 0, 0)).toBe(empty);
    const input = makeConversation(3);
    for (const [from, to] of [
      [-1, 0], [0, -1], [3, 0], [0, 3], [1, 1],
      [0.5, 1], [1, 0.5], [Number.NaN, 1], [0, Number.POSITIVE_INFINITY],
    ]) expect(reorderQueued(input, from!, to!)).toBe(input);
  });

  test("lazy text and attachment reads touch queued users once, never completed history", () => {
    const history: UserMessage = { id: "history-user", role: "user", text: "history", at: 1 };
    Object.defineProperty(history, "text", { get() { throw new Error("history text accessed"); } });
    Object.defineProperty(history, "attachments", { get() { throw new Error("history attachments accessed"); } });
    const first: UserMessage = { id: "queued-0", role: "user", text: "text-0", at: 2 };
    const second: UserMessage = { id: "queued-1", role: "user", text: "text-1", at: 3 };
    const textReads = [0, 0];
    const attachmentReads = [0, 0];
    for (const [index, user] of [first, second].entries()) {
      Object.defineProperty(user, "text", {
        get() { textReads[index] = (textReads[index] ?? 0) + 1; return "text-" + index; },
      });
      Object.defineProperty(user, "attachments", {
        get() { attachmentReads[index] = (attachmentReads[index] ?? 0) + 1; return []; },
      });
    }
    const input: Conversation = {
      id: "lazy", harness: "hermes", title: "Lazy access", createdAt: 1, updatedAt: 2,
      messages: [
        history,
        { id: "history-done", role: "assistant", text: "done", at: 1, state: "done", turnId: "done", seq: 0 },
        first,
        { id: "pending-0", role: "assistant", text: "", at: 2, state: "pending", turnId: "turn-0", seq: 0 },
        { id: "orphan", role: "assistant", text: "", at: 2, state: "pending", turnId: "orphan", seq: 0 },
        second,
        { id: "pending-1", role: "assistant", text: "", at: 3, state: "pending", turnId: "turn-1", seq: 0 },
      ],
    };
    expect(mergedQueue(queuedParts(input))).toBe("text-0\n\ntext-1");
    expect(textReads).toEqual([1, 1]);
    expect(queueMergeError(input)).toBeUndefined();
    expect(attachmentReads).toEqual([1, 1]);
    expect(queuedParts(reorderQueued(input, 1, 0)).map(part => part.user.id)).toEqual(["queued-1", "queued-0"]);
    expect(textReads).toEqual([1, 1]);
    expect(attachmentReads).toEqual([1, 1]);
  });

  test("indexed source reads stay linear for large queue scans and transforms", () => {
    const source = makeConversation(2_048);
    const size = source.messages.length;
    const scan = countIndexedReads(source);
    expect(queuedParts(scan.input)).toHaveLength(2_048);
    expect(scan.reads()).toBeLessThanOrEqual(2 * size);

    const merge = countIndexedReads(source);
    expect(combineQueued(merge.input).messages).toHaveLength(size - 2 * (2_048 - 1));
    // Two queue scans, one filter pass; allowance includes standard array reads.
    expect(merge.reads()).toBeLessThanOrEqual(6 * size);

    const reorder = countIndexedReads(source);
    expect(queuedParts(reorderQueued(reorder.input, 0, 2_047))).toHaveLength(2_048);
    // One queue scan and one result-map pass; no quadratic source rescans.
    expect(reorder.reads()).toBeLessThanOrEqual(4 * size);

    const cap = countIndexedReads(source);
    expect(queueMergeError(cap.input)).toBeUndefined();
    expect(cap.reads()).toBeLessThanOrEqual(3 * size);
  });
});
