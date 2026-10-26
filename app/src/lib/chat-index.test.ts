import { describe, expect, test } from "bun:test";
import { chatKey, type ChatSummary } from "../../../shared/protocol";
import type { Conversation } from "../model";
import { applyHead, conversationEntries, conversationEntry, conversationKey, emptyList, entryStats, groupLabeler, listRows, mergeLocalAndRemote, mergePage, type ChatListRow } from "./chat-index";

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 26, 12).getTime();

export function summary(n: number, patch: Partial<ChatSummary> = {}): ChatSummary {
  const sessionId = `s${n}`;
  return {
    key: chatKey({ hostId: "groot", kind: "codex", sessionId }), kind: "codex", sessionId, hostId: "groot", hostName: "groot",
    title: `chat ${n}`, startedAt: NOW - n * 1000, lastActivityAt: NOW - n * 1000, messageCount: 3, origin: "agentsview", chatable: true, ...patch,
  };
}
function page(items: ChatSummary[], next: string | null = "c", rev = 1) { return { items, next, rev }; }
function conversation(id: string, patch: Partial<Conversation> = {}): Conversation {
  return { id, harness: "omp", title: id, createdAt: NOW, updatedAt: NOW, messages: [], ...patch };
}
const keys = (rows: ChatListRow[]) => rows.filter(r => r.type === "chat").map(r => r.key);

describe("mergePage", () => {
  test("appends new keys, dedupes known keys, keeps identity of unchanged rows", () => {
    const a = summary(1), b = summary(2), c = summary(3);
    const first = mergePage(emptyList(), page([a, b]));
    const rowB = listRows(first)[1];
    const second = mergePage(first, page([{ ...b }, c], null));
    expect(listRows(second).map(r => r.key)).toEqual([a.key, b.key, c.key]);
    expect(listRows(second)[1]).toBe(rowB);
    expect(second.exhausted).toBe(true);
    const third = mergePage(second, page([{ ...b, title: "renamed" }], null));
    expect(listRows(third)[1]?.title).toBe("renamed");
    expect(listRows(third)).toHaveLength(3);
  });
});

describe("applyHead", () => {
  test("prepends new keys and lifts bumped rows; unchanged rows keep identity", () => {
    const rows = [1, 2, 3, 4].map(n => summary(n));
    const loaded = mergePage(emptyList(), page(rows));
    const kept = listRows(loaded)[2];
    const fresh = summary(0, { key: "new", sessionId: "new", lastActivityAt: NOW + 5000 });
    const bumped = { ...summary(4), lastActivityAt: NOW + 1000 };
    const renamed = { ...summary(2), title: "renamed" };
    const next = applyHead(loaded, page([fresh, bumped, summary(1), renamed, summary(3)]));
    expect(listRows(next).map(r => r.key)).toEqual(["new", summary(4).key, summary(1).key, summary(2).key, summary(3).key]);
    expect(listRows(next)[3]?.title).toBe("renamed");
    expect(listRows(next)[4]).toBe(kept);
    expect(next.next).toBe(loaded.next);
  });
  test("an unchanged head returns the same list (no re-render)", () => {
    const loaded = mergePage(emptyList(), page([summary(1), summary(2)]));
    expect(applyHead(loaded, page([summary(1), summary(2)]))).toBe(loaded);
  });
});

describe("mergeLocalAndRemote", () => {
  test("local wins over its remote summary and rows interleave by activity", () => {
    const remote = [summary(1), summary(3), summary(5)];
    const opened = conversation("live:codex:s3", { harness: "codex", sessionId: "s3", targetHostId: "groot", updatedAt: NOW - 3000 });
    const local = conversation("phone", { updatedAt: NOW - 2000 });
    const rows = mergeLocalAndRemote({ local: conversationEntries([opened, local]), remote, exhausted: true, now: NOW });
    expect(keys(rows)).toEqual([summary(1).key, "local:phone", summary(3).key, summary(5).key]);
    const openedRow = rows.find(r => r.type === "chat" && r.key === summary(3).key);
    expect(openedRow?.type === "chat" ? openedRow.local?.id : undefined).toBe("live:codex:s3");
  });
  test("window cut: an old local row waits until the remote list reaches it", () => {
    const remote = [summary(1), summary(2)];
    const old = conversation("old", { updatedAt: NOW - 100 * DAY });
    const partial = mergeLocalAndRemote({ local: conversationEntries([old]), remote, exhausted: false, now: NOW });
    expect(keys(partial)).toEqual([summary(1).key, summary(2).key]);
    const done = mergeLocalAndRemote({ local: conversationEntries([old]), remote, exhausted: true, now: NOW });
    expect(keys(done)).toEqual([summary(1).key, summary(2).key, "local:old"]);
  });
  test("sections are counted in the same single pass", () => {
    const remote = [summary(1), summary(2), summary(3, { lastActivityAt: NOW - DAY })];
    const attention = conversation("err", { messages: [{ id: "a", role: "assistant", text: "", at: NOW, state: "error", turnId: "t", seq: 1 }] });
    const rows = mergeLocalAndRemote({ local: conversationEntries([attention]), remote, exhausted: true, now: NOW });
    const sections = rows.filter(r => r.type === "section").map(r => r.type === "section" ? [r.title, r.count] : []);
    expect(sections).toEqual([["Needs attention", 1], ["Today", 2], ["Yesterday", 1]]);
  });
  test("legacy mode keeps ended chats in a trailing section", () => {
    const ended = conversation("ended", { stale: true, updatedAt: NOW });
    const live = conversation("live", { updatedAt: NOW - 1000 });
    const rows = mergeLocalAndRemote({ local: conversationEntries([ended, live]), remote: [], exhausted: true, endedLast: true, now: NOW });
    expect(rows.map(r => r.type === "section" ? `#${r.title}` : r.key)).toEqual(["#Today", "local:live", "#Ended", "local:ended"]);
  });
});

describe("conversation entries", () => {
  test("entries are built once per conversation revision", () => {
    const c = conversation("a");
    const before = entryStats.builds;
    const first = conversationEntry(c);
    expect(conversationEntry(c)).toBe(first);
    expect(entryStats.builds - before).toBe(1);
    expect(conversationEntry({ ...c, title: "b" })).not.toBe(first);
  });
  test("keys match the bridge index for host chats; hermes keys carry the profile", () => {
    expect(conversationKey({ id: "x", harness: "codex", sessionId: "s", targetHostId: "groot" })).toBe(chatKey({ hostId: "groot", kind: "codex", sessionId: "s" }));
    expect(conversationKey({ id: "x", harness: "hermes", sessionId: "s", targetHostId: "groot", profileName: "clean" })).toBe("groot:hermes:s:clean");
    expect(conversationKey({ id: "x", harness: "omp" })).toBe("local:x");
  });
  test("month labels are computed once per month", () => {
    const label = groupLabeler(NOW);
    expect(label(NOW)).toBe("Today");
    const early = new Date(2026, 5, 3).getTime(), late = new Date(2026, 5, 28).getTime();
    expect(label(early)).toBe(label(late));
    expect(label(early)).not.toBe(label(new Date(2026, 4, 28).getTime()));
  });
});
