import { beforeEach, describe, expect, test } from "bun:test";
import type { ApiResult } from "../net/chats-api";
import type { ChatsApi } from "../net/chats-api";
import type { HistoryPage } from "../../../shared/protocol";
import type { Conversation } from "../model";
import { configureHistoryPages, historyPages, historyState, loadOlder, prependOlder, primeCursor, setHistoryCursor } from "./history-pages";
import type { HistoryMessage } from "../../../shared/protocol";

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
  test("messages without a timestamp do not end scrollback early: a page of at=0 then a normal page both appear", async () => {
    setHistoryCursor("c", "cur1");
    responses = [
      { ok: true, value: { messages: [{ id: "av:5", role: "user", text: "no time a", at: 0 }, { id: "av:6", role: "assistant", text: "no time b", at: 0 }], before: "cur2" } },
      { ok: true, value: { messages: [{ id: "av:3", role: "user", text: "older", at: 3 }, { id: "av:4", role: "assistant", text: "older b", at: 4 }], before: null } },
    ];
    await loadOlder(chat);
    expect(historyState("c").older.map(m => m.id)).toEqual(["av:5", "av:6"]);
    await loadOlder(chat);
    expect(historyState("c").older.map(m => m.id)).toEqual(["av:3", "av:4", "av:5", "av:6"]);
    expect(historyState("c").before).toBeNull();
  });
  test("messages that share a timestamp across a page boundary are all kept", async () => {
    setHistoryCursor("c", "cur1");
    responses = [
      { ok: true, value: { messages: [{ id: "av:8", role: "assistant", text: "tie b", at: 8 }, { id: "av:9", role: "user", text: "x", at: 9 }], before: "cur2" } },
      // The server keyset is exact: av:7 shares av:8's timestamp and must not be lost.
      { ok: true, value: { messages: [{ id: "av:6", role: "user", text: "y", at: 6 }, { id: "av:7", role: "user", text: "tie a", at: 8 }], before: null } },
    ];
    await loadOlder(chat);
    await loadOlder(chat);
    expect(historyState("c").older.map(m => m.id)).toEqual(["av:6", "av:7", "av:8", "av:9"]);
  });
  test("the first page after the shown window keeps a sibling with the oldest shown time but drops a phone-id copy", async () => {
    const phone: Conversation = { ...chat, messages: [{ id: "phone-1", role: "user", text: "hi", at: 10 }, { id: "phone-2", role: "assistant", text: "yo", at: 11, state: "done", turnId: "t", seq: 0 }] };
    setHistoryCursor("c", "cur1");
    responses = [{ ok: true, value: { messages: [{ id: "av:9", role: "user", text: "sibling", at: 10 }, { id: "av:10", role: "user", text: "hi", at: 10 }, { id: "av:11", role: "assistant", text: "yo", at: 11 }], before: null } }];
    await loadOlder(phone);
    expect(historyState("c").older.map(m => m.id)).toEqual(["av:9"]);
  });
  test("prependOlder keeps the in-memory cap", () => {
    const many = Array.from({ length: 2100 }, (_, i) => ({ id: `m${i}`, role: "user" as const, text: "x", at: i }));
    expect(prependOlder({ older: [], before: "c", loading: false }, many, new Set(), "d").older).toHaveLength(2000);
  });
});

/** Host messages n..m (ids av:n), one per second; n is oldest. */
function hostRange(from: number, to: number): HistoryMessage[] {
  const out: HistoryMessage[] = [];
  for (let n = from; n <= to; n++) out.push({ id: `av:${n}`, role: n % 2 ? "assistant" : "user", text: `m${n}`, at: n * 1000 });
  return out;
}

describe("chats with phone message ids (Dash-started)", () => {
  // The cached window: the newest 80 host messages (101..180) under local ids.
  const cached: Conversation = { ...chat, id: "d", messages: hostRange(101, 180).map(m => ({ id: `local-${m.id}`, role: "user", text: m.text, at: m.at })) };

  test("primeCursor walks past the cached window, so no cached message shows twice", async () => {
    responses = [
      { ok: true, value: { messages: hostRange(131, 180), before: "p1" } },
      { ok: true, value: { messages: hostRange(81, 130), before: "p2" } },
    ];
    await primeCursor(cached);
    expect(requested.map(r => r.before)).toEqual([undefined, "p1"]);
    expect(historyState("d").older.map(m => m.id)).toEqual(hostRange(81, 100).map(m => m.id));
    expect(historyState("d").before).toBe("p2");
    responses = [{ ok: true, value: { messages: hostRange(31, 80), before: "p3" } }];
    await loadOlder(cached);
    const texts = [...historyState("d").older, ...cached.messages].map(m => m.text);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts).toEqual(hostRange(31, 180).map(m => m.text));
  });

  test("loadOlder drops page messages not older than everything shown", async () => {
    setHistoryCursor("d", "inside");
    // A cursor that points inside the cached window returns messages already on screen.
    responses = [{ ok: true, value: { messages: hostRange(91, 140), before: "p" } }];
    await loadOlder(cached);
    expect(historyState("d").older.map(m => m.id)).toEqual(hostRange(91, 100).map(m => m.id));
  });

  test("primeCursor stops at the start of the chat", async () => {
    responses = [{ ok: true, value: { messages: hostRange(131, 180), before: null } }];
    await primeCursor(cached);
    expect(historyState("d").before).toBeNull();
    expect(historyState("d").older).toEqual([]);
  });
});

