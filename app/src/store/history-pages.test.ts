import { beforeEach, describe, expect, test } from "bun:test";
import type { ApiResult } from "../net/chats-api";
import type { ChatsApi } from "../net/chats-api";
import type { HistoryPage } from "../../../shared/protocol";
import type { Conversation } from "../model";
import { configureHistoryPages, historyPages, historyState, loadOlder, prependOlder, setHistoryCursor } from "./history-pages";

const chat: Conversation = { id: "c", harness: "codex", title: "t", createdAt: 1, updatedAt: 1, sessionId: "s", targetHostId: "groot",
  messages: [{ id: "av:10", role: "user", text: "newest", at: 10 }] };
let responses: ApiResult<HistoryPage>[] = [];
const requested: { key: string; before?: string | null }[] = [];
const unused = async (): Promise<never> => { throw new Error("unused"); };
const api: ChatsApi = {
  list: unused, search: unused, message: unused,
  history: async (_s, params) => { requested.push({ key: params.key, before: params.before }); return responses.shift() ?? { ok: false, status: 0, code: "network" }; },
};

beforeEach(() => {
  historyPages.set({}); responses = []; requested.length = 0;
  configureHistoryPages({ api, settings: () => ({ address: "groot:4747", token: "t" }) });
});

describe("history pages", () => {
  test("older pages prepend, dedupe and stop at the start of the chat", async () => {
    setHistoryCursor("c", "cur1");
    responses = [
      { ok: true, value: { messages: [{ id: "av:8", role: "user", text: "a", at: 8 }, { id: "av:9", role: "assistant", text: "b", at: 9, truncated: true }, { id: "av:10", role: "user", text: "dup", at: 10 }], before: "cur2" } },
      { ok: true, value: { messages: [{ id: "av:7", role: "assistant", text: "c", at: 7 }], before: null } },
    ];
    await loadOlder(chat);
    expect(requested[0]).toEqual({ key: "groot:codex:s", before: "cur1" });
    expect(historyState("c").older.map(m => m.id)).toEqual(["av:8", "av:9"]);
    expect(historyState("c").older[1]?.truncated).toBe(true);
    await loadOlder(chat);
    expect(historyState("c").older.map(m => m.id)).toEqual(["av:7", "av:8", "av:9"]);
    expect(historyState("c").before).toBeNull();
    await loadOlder(chat);
    expect(requested).toHaveLength(2);
    // A refreshed newest page (Hermes poll) does not reset loaded older pages.
    setHistoryCursor("c", "newer");
    expect(historyState("c").before).toBeNull();
  });
  test("an old bridge reply without `before` leaves paging unavailable", async () => {
    setHistoryCursor("c", undefined);
    await loadOlder(chat);
    expect(requested).toEqual([]);
  });
  test("prependOlder keeps the in-memory cap", () => {
    const many = Array.from({ length: 2100 }, (_, i) => ({ id: `m${i}`, role: "user" as const, text: "x", at: i }));
    expect(prependOlder({ older: [], before: "c", loading: false }, many, new Set(), "d").older).toHaveLength(2000);
  });
});
