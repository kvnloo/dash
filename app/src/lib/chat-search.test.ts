import { describe, expect, test } from "bun:test";
import { chatKey, type ChatSearchHit, type ChatSummary } from "../../../shared/protocol";
import type { Conversation } from "../model";
import { conversationEntries } from "./chat-index";
import { localIndexStats, localRowModel, mergeSearch, reuseRows, searchLocal, searchTerms, snippetSegments } from "./chat-search";

const NOW = 1_800_000_000_000;
const name = (id: string) => id.toUpperCase();
function chat(id: string, patch: Partial<Conversation> = {}): Conversation {
  return { id, harness: "codex", title: `title ${id}`, createdAt: NOW, updatedAt: NOW, messages: [], ...patch };
}
function hit(sessionId: string, snippet = "the deploy failed", highlights = [{ start: 4, end: 10 }]): ChatSearchHit {
  const summary: ChatSummary = { key: chatKey({ hostId: "groot", kind: "codex", sessionId }), kind: "codex", sessionId, hostId: "groot", hostName: "groot",
    title: `remote ${sessionId}`, startedAt: NOW, lastActivityAt: NOW, messageCount: 4, origin: "agentsview", chatable: true };
  return { chat: summary, field: "message", messageId: "av:1", role: "assistant", at: NOW, snippet, highlights };
}

describe("local chat search", () => {
  test("the haystack is built once per conversation reference", () => {
    const chats = [chat("a"), chat("b")];
    const entries = conversationEntries(chats);
    const before = localIndexStats.builds;
    searchLocal(entries, "title", name);
    searchLocal(entries, "title a", name);
    searchLocal(entries, "codex", name);
    expect(localIndexStats.builds - before).toBe(2);
    const changed = conversationEntries([{ ...chats[0]!, title: "renamed" }, chats[1]!]);
    searchLocal(changed, "renamed", name);
    expect(localIndexStats.builds - before).toBe(3);
  });
  test("every term must match; results are newest first and capped at 50", () => {
    const chats = Array.from({ length: 80 }, (_, i) => chat(`c${i}`, { updatedAt: NOW - i, cwd: i % 2 ? "/work/dash" : "/work/other" }));
    const results = searchLocal(conversationEntries(chats), "title dash", name);
    expect(results).toHaveLength(40);
    expect(results[0]?.entry.id).toBe("c1");
    expect(searchLocal(conversationEntries(chats), "title", name)).toHaveLength(50);
    expect(searchTerms("  Deploy  FAILED ")).toEqual(["deploy", "failed"]);
  });
});

describe("mergeSearch", () => {
  test("dedupes by chat key; a local hit takes the remote snippet", () => {
    const opened = chat("live:codex:s1", { sessionId: "s1", targetHostId: "groot" });
    const local = searchLocal(conversationEntries([opened]), "title", name).map(row => localRowModel(row, ["title"]));
    const rows = mergeSearch(local, [hit("s1"), hit("s2"), hit("s2", "dup")], name);
    expect(rows.map(r => r.key)).toEqual([hit("s1").chat.key, hit("s2").chat.key]);
    expect(rows[0]?.conversationId).toBe("live:codex:s1");
    expect(rows[0]?.segments).toEqual([{ text: "the ", hit: false }, { text: "deploy", hit: true }, { text: " failed", hit: false }]);
    expect(rows[1]?.summary?.sessionId).toBe("s2");
  });
  test("unchanged rows keep identity between runs", () => {
    const first = reuseRows(new Map(), mergeSearch([], [hit("s1"), hit("s2")], name));
    const second = reuseRows(first.byKey, mergeSearch([], [hit("s1"), hit("s2", "changed", [])], name));
    expect(second.rows[0]).toBe(first.rows[0]);
    expect(second.rows[1]).not.toBe(first.rows[1]);
  });
  test("snippet segments clamp bad and overlapping highlights", () => {
    expect(snippetSegments("abcdef", [{ start: 1, end: 3 }, { start: 2, end: 4 }, { start: 9, end: 12 }])).toEqual([
      { text: "a", hit: false }, { text: "bc", hit: true }, { text: "d", hit: true }, { text: "ef", hit: false },
    ]);
    expect(snippetSegments("", [])).toEqual([{ text: "", hit: false }]);
  });
});
