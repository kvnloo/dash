import { describe, expect, test } from "bun:test";
import { combineQueued, mergedQueue, queuedParts, reorderQueued, queueMergeError } from "./pending-queue";
import { parseConversation, type Conversation } from "../model";

function fixture(): Conversation {
  return { id: "q", harness: "hermes", title: "Queue", createdAt: 1, updatedAt: 1, messages: [
    { id: "running", role: "assistant", text: "", at: 1, state: "streaming", turnId: "running", seq: 0 },
    ...["First", "Second", "Third"].flatMap((text, i) => [
      { id: `u${i}`, role: "user", text, at: 2 },
      { id: `a${i}`, role: "assistant", text: "", at: 2, state: "pending", turnId: `t${i}`, seq: 0 },
    ] satisfies Conversation["messages"]),
  ] };
}

describe("durable queue transformations", () => {
  test("raw merge uses blank lines, preserves pair identity and in-order parts", () => {
    const c = fixture();
    expect(queuedParts(c).map(p => p.assistant.turnId)).toEqual(["t0", "t1", "t2"]);
    expect(mergedQueue(queuedParts(c))).toBe("First\n\nSecond\n\nThird");
    const merged = combineQueued(c);
    expect(merged.messages).toHaveLength(3);
    expect(merged.messages[0]).toBe(c.messages[0]);
    expect(queuedParts(merged).map(p => [p.user.text, p.assistant.turnId])).toEqual([["First\n\nSecond\n\nThird", "t0"]]);
    expect(queuedParts(c)).toHaveLength(3);
    expect(combineQueued({ ...c, messages: [] })).toEqual({ ...c, messages: [] });
  });
  test("drag reorders only pending pairs, clamps invalid moves to no-op", () => {
    const c = fixture();
    const reordered = reorderQueued(c, 2, 0);
    expect(mergedQueue(queuedParts(reordered))).toBe("Third\n\nFirst\n\nSecond");
    expect(reordered.messages[0]).toBe(c.messages[0]);
    expect(mergedQueue(queuedParts(reorderQueued(c, 0, 2)))).toBe("Second\n\nThird\n\nFirst");
    for (const [from, to] of [[-1, 0], [0, -1], [3, 0], [0, 3], [0, 0], [0.5, 1], [1, 0.5]]) expect(reorderQueued(c, from!, to!)).toBe(c);
  });
  test("persistence defaults on and retains order, explicit off, preview and external wait", () => {
    const c = reorderQueued(fixture(), 1, 0);
    const parsed = parseConversation(JSON.parse(JSON.stringify({ ...c, deliverQueuedAsOne: false, queuePreview: "edited", queueWaitForIdle: true })));
    expect(parsed?.deliverQueuedAsOne).toBe(false);
    expect(parsed?.queuePreview).toBe("edited");
    expect(parsed?.queueWaitForIdle).toBe(true);
    expect(parsed && mergedQueue(queuedParts(parsed))).toBe("Second\n\nFirst\n\nThird");
    expect(parseConversation(c)?.deliverQueuedAsOne).toBe(true);
    expect(parseConversation({ ...c, queuePreview: 4 })?.queuePreview).toBeUndefined();
  });
  test("attachment overflow blocks combined delivery instead of losing references", () => {
    const c = fixture();
    expect(queueMergeError(c)).toBeUndefined();
    const attachment = { id: "0".repeat(32), name: "file.txt", mime: "text/plain", size: 1 };
    const withCount = (count: number) => ({ ...c, messages: c.messages.map(m => m.id === "u0" && m.role === "user" ? { ...m, attachments: Array.from({ length: count }, () => attachment) } : m) });
    expect(queueMergeError(withCount(8))).toBeUndefined();
    expect(queueMergeError(withCount(9))).toBe("Over 8 attachments: remove messages or turn off combined delivery.");
  });
  test("merge retains all attachments in order and ignores nonpending receipts", () => {
    const c = fixture();
    const attachments = [0, 1, 2].map(i => ({ id: String(i).repeat(32), name: `${i}.txt`, mime: "text/plain", size: 1 }));
    c.messages = c.messages.map(m => m.role === "user" ? { ...m, attachments: [attachments[Number(m.id.slice(1))]!]} : m);
    expect(queuedParts(combineQueued(c))[0]?.user.attachments).toEqual(attachments);
    expect(queuedParts({ ...c, messages: c.messages.map(m => m.role === "assistant" ? { ...m, state: "done" } : m) })).toEqual([]);
  });
});
