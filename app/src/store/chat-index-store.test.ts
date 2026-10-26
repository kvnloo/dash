import { beforeEach, describe, expect, test } from "bun:test";
import type { ChatPage, ChatSummary } from "../../../shared/protocol";
import { listRows } from "../lib/chat-index";
import type { ApiResult, ChatsApi } from "../net/chats-api";
import { HEAD_SNAPSHOT_KEY } from "./chat-index-snapshot";
import { chatIndexStore, configureChatIndex, DEFAULT_QUERY, listState, loadMore, refreshHead, resetChatIndex, seedFromSnapshot, setChatsFeatures, summaryByKey } from "./chat-index-store";

function summary(n: number, patch: Partial<ChatSummary> = {}): ChatSummary {
  return { key: `groot:codex:s${n}`, kind: "codex", sessionId: `s${n}`, hostId: "groot", hostName: "groot", title: `chat ${n}`, startedAt: 1, lastActivityAt: 1000 - n,
    messageCount: 2, origin: "agentsview", chatable: true, ...patch };
}
let pages: ApiResult<ChatPage>[] = [];
const calls: { cursor?: string | null; etag?: string }[] = [];
const storage = new Map<string, string>();
const unused = async (): Promise<never> => { throw new Error("unused"); };
const api: ChatsApi = {
  list: async (_settings, params, opts = {}) => { calls.push({ cursor: params.cursor, etag: opts.etag }); return pages.shift() ?? { ok: false, status: 0, code: "network" }; },
  search: unused, history: unused, message: unused,
};

beforeEach(() => {
  resetChatIndex(); pages = []; calls.length = 0; storage.clear();
  configureChatIndex({ api, settings: () => ({ address: "groot:4747", token: "t" }), now: () => Date.now(),
    storage: { getItem: async key => storage.get(key) ?? null, setItem: async (key, value) => { storage.set(key, value); } } });
});

describe("chat index store", () => {
  test("legacy bridges never fetch", async () => {
    setChatsFeatures(undefined);
    await refreshHead();
    expect(calls).toEqual([]);
    expect(chatIndexStore.get().mode).toBe("legacy");
  });
  test("page 1, then pages by cursor; dedupe; snapshot saved; 304 keeps rows", async () => {
    setChatsFeatures(["chats.v1"]);
    pages = [{ ok: true, value: { items: [summary(1), summary(2)], next: "c1", rev: 1 }, etag: "e1" }];
    await refreshHead();
    expect(listRows(listState(DEFAULT_QUERY).list).map(r => r.sessionId)).toEqual(["s1", "s2"]);
    expect(storage.get(HEAD_SNAPSHOT_KEY)).toContain("\"etag\":\"e1\"");
    pages = [{ ok: true, value: { items: [summary(2), summary(3)], next: null, rev: 1 } }];
    await loadMore();
    expect(calls.at(-1)?.cursor).toBe("c1");
    expect(listRows(listState(DEFAULT_QUERY).list).map(r => r.sessionId)).toEqual(["s1", "s2", "s3"]);
    expect(listState(DEFAULT_QUERY).list.exhausted).toBe(true);
    await loadMore();
    expect(calls).toHaveLength(2);
    const before = listState(DEFAULT_QUERY).list;
    pages = [{ ok: false, notModified: true }];
    await refreshHead({}, { force: true });
    expect(calls.at(-1)?.etag).toBe("e1");
    expect(listState(DEFAULT_QUERY).list).toBe(before);
    expect(summaryByKey("groot:codex:s3")?.title).toBe("chat 3");
  });
  test("the persisted head seeds the first paint and the first page replaces it in place", async () => {
    storage.set(HEAD_SNAPSHOT_KEY, JSON.stringify({ items: [summary(1), summary(2)], next: "old", rev: 1 }));
    await seedFromSnapshot();
    const seeded = listState(DEFAULT_QUERY);
    expect(seeded.seeded).toBe(true);
    const kept = listRows(seeded.list)[1];
    setChatsFeatures(["chats.v1"]);
    pages = [{ ok: true, value: { items: [summary(0), summary(1), summary(2)], next: "fresh", rev: 2 } }];
    await refreshHead();
    const state = listState(DEFAULT_QUERY);
    expect(state.seeded).toBe(false);
    expect(listRows(state.list).map(r => r.sessionId)).toEqual(["s0", "s1", "s2"]);
    expect(listRows(state.list)[2]).toBe(kept);
    expect(state.list.next).toBe("fresh");
  });
  test("a stale cursor restarts from page 1", async () => {
    setChatsFeatures(["chats.v1"]);
    pages = [{ ok: true, value: { items: [summary(1)], next: "c1", rev: 1 } }, { ok: false, status: 400, code: "bad_cursor" }, { ok: true, value: { items: [summary(5)], next: null, rev: 9 } }];
    await refreshHead();
    await loadMore();
    expect(listRows(listState(DEFAULT_QUERY).list).map(r => r.sessionId)).toEqual(["s5"]);
  });
});
