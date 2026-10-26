import { describe, expect, test } from "bun:test";
import {
  CHATS_FEATURE,
  chatKey,
  decodeCursor,
  encodeCursor,
  parseChatListQuery,
  parseChatPage,
  parseChatSearchPage,
  parseChatSearchQuery,
  parseHistoryPage,
  parseHistoryQuery,
  type ChatSummary,
} from "./protocol";

const q = (s: string) => new URLSearchParams(s);
const summary = (over: Partial<ChatSummary> = {}): ChatSummary => ({
  key: "groot:codex:c1", kind: "codex", sessionId: "c1", hostId: "groot", hostName: "groot", title: "fix list",
  startedAt: 1, lastActivityAt: 2, messageCount: 3, origin: "agentsview", chatable: true, ...over,
});

describe("chats.v1 feature", () => {
  test("feature id is stable", () => expect(CHATS_FEATURE).toBe("chats.v1"));
});

describe("parseChatListQuery", () => {
  test("defaults and clamps limit", () => {
    expect(parseChatListQuery(q(""))).toEqual({ limit: 50, kinds: [], hosts: [], chatable: false });
    expect(parseChatListQuery(q("limit=1000"))).toMatchObject({ limit: 100 });
    expect(parseChatListQuery(q("limit=0"))).toMatchObject({ limit: 1 });
    expect(parseChatListQuery(q("limit=abc"))).toEqual({ error: "bad_request", field: "limit" });
  });
  test("kind/host csv validated and named on error", () => {
    expect(parseChatListQuery(q("kind=codex,claude&host=groot,machine:abc&chatable=1"))).toEqual({ limit: 50, kinds: ["codex", "claude"], hosts: ["groot", "machine:abc"], chatable: true });
    expect(parseChatListQuery(q("kind=co dex"))).toEqual({ error: "bad_request", field: "kind" });
    expect(parseChatListQuery(q(`host=${"h,".repeat(17)}`))).toEqual({ error: "bad_request", field: "host" });
    expect(parseChatListQuery(q(`kind=${"a".repeat(65)}`))).toEqual({ error: "bad_request", field: "kind" });
  });
  test("cursor must decode", () => {
    expect(parseChatListQuery(q("cursor=%%%"))).toEqual({ error: "bad_cursor", field: "cursor" });
    const cursor = encodeCursor({ v: 1, t: 5, k: "a", f: "x" });
    expect(parseChatListQuery(q(`cursor=${cursor}`))).toMatchObject({ cursor });
  });
});

describe("parseChatSearchQuery", () => {
  test("q bounds", () => {
    expect(parseChatSearchQuery(q(""))).toEqual({ error: "bad_request", field: "q" });
    expect(parseChatSearchQuery(q(`q=${"a".repeat(201)}`))).toEqual({ error: "bad_request", field: "q" });
    expect(parseChatSearchQuery(q("q=hello&limit=99"))).toEqual({ q: "hello", limit: 50, kinds: [], hosts: [], in: "all" });
    expect(parseChatSearchQuery(q("q=hello&in=titles"))).toMatchObject({ in: "titles", limit: 20 });
    expect(parseChatSearchQuery(q("q=hello&in=bogus"))).toEqual({ error: "bad_request", field: "in" });
  });
  test("more than 8 terms rejected", () => {
    expect(parseChatSearchQuery(q("q=a b c d e f g h i"))).toEqual({ error: "bad_request", field: "q" });
  });
});

describe("parseHistoryQuery", () => {
  test("key or kind+sessionId", () => {
    expect(parseHistoryQuery(q("key=groot:codex:c1"))).toEqual({ key: "groot:codex:c1", limit: 50 });
    expect(parseHistoryQuery(q("kind=codex&sessionId=c1&host=groot&limit=500"))).toEqual({ kind: "codex", sessionId: "c1", host: "groot", limit: 200 });
    expect(parseHistoryQuery(q("kind=codex"))).toEqual({ error: "bad_request", field: "sessionId" });
    expect(parseHistoryQuery(q(""))).toEqual({ error: "bad_request", field: "key" });
    expect(parseHistoryQuery(q("key=x&before=!!"))).toEqual({ error: "bad_cursor", field: "before" });
  });
});

describe("cursors", () => {
  test("round trip, including non-ASCII", () => {
    const value = { v: 1, t: 123, k: "groot:codex:ü-会话", f: "abc" };
    const encoded = encodeCursor(value);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(encoded)).toEqual(value);
  });
  test("oversize, bad base64 and bad JSON are null", () => {
    expect(decodeCursor("A".repeat(1025))).toBeNull();
    expect(decodeCursor("ab+/")).toBeNull();
    expect(decodeCursor(encodeCursor({ v: 1 }).slice(0, -2) + "__")).toBeNull();
    expect(decodeCursor(btoaUrl("not json"))).toBeNull();
    expect(decodeCursor(btoaUrl("[1,2]"))).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });
});

function btoaUrl(s: string): string { return Buffer.from(s, "utf8").toString("base64url"); }

describe("response parsers drop malformed items one at a time", () => {
  test("chat page", () => {
    const page = parseChatPage({ items: [summary(), { key: 1 }, summary({ key: "b", origin: "nope" as "live" })], next: null, rev: 3 });
    expect(page).toEqual({ items: [summary()], next: null, rev: 3 });
    expect(parseChatPage({ items: "x", next: null, rev: 1 })).toBeNull();
    expect(parseChatPage({ items: [], next: 4, rev: 1 })).toBeNull();
  });
  test("search page", () => {
    const hit = { chat: summary(), field: "message", messageId: "av:1", role: "user", at: 5, snippet: "hello world", highlights: [{ start: 0, end: 5 }] };
    const page = parseChatSearchPage({ hits: [hit, { ...hit, field: "zzz" }, { ...hit, highlights: [{ start: 3, end: 1 }] }], next: "abc", partial: true });
    expect(page).toEqual({ hits: [hit], next: "abc", partial: true });
    expect(parseChatSearchPage({ hits: [], next: null })).toBeNull();
  });
  test("history page", () => {
    const page = parseHistoryPage({ messages: [{ id: "av:1", role: "user", text: "hi", at: 1, truncated: true }, { id: 2 }], before: null });
    expect(page).toEqual({ messages: [{ id: "av:1", role: "user", text: "hi", at: 1, truncated: true }], before: null });
  });
});

describe("chatKey", () => {
  test("same session, same key, whatever the origin", () => {
    expect(chatKey({ hostId: "groot", kind: "codex", sessionId: "c1" })).toBe("groot:codex:c1");
    expect(chatKey({ hostId: "groot", kind: "codex", sessionId: "c1", profileId: "omp:tab" })).toBe("groot:codex:c1");
    expect(chatKey({ hostId: "groot", kind: "hermes", sessionId: "s", profileId: "default" })).toBe("groot:hermes:s:default");
  });
});
