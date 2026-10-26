import { describe, expect, test } from "bun:test";
import { LRU } from "./lru";

describe("LRU", () => {
  test("evicts the least recently used entry first", () => {
    const evicted: string[] = [];
    const lru = new LRU<number>({ maxEntries: 2, onEvict: key => evicted.push(key) });
    lru.set("a", 1); lru.set("b", 2); lru.set("c", 3);
    expect(lru.keys()).toEqual(["b", "c"]);
    expect(lru.get("a")).toBeUndefined();
    expect(evicted).toEqual(["a"]);
  });
  test("get refreshes recency; peek does not", () => {
    const lru = new LRU<number>({ maxEntries: 2 });
    lru.set("a", 1); lru.set("b", 2);
    expect(lru.get("a")).toBe(1);
    lru.set("c", 3);
    expect(lru.keys()).toEqual(["a", "c"]);
    expect(lru.peek("a")).toBe(1);
    lru.set("d", 4);
    expect(lru.has("a")).toBe(false);
  });
  test("TTL expires entries with an injected clock", () => {
    let now = 1000;
    const lru = new LRU<string>({ maxEntries: 4, ttlMs: 60, now: () => now });
    lru.set("q", "page");
    now = 1059;
    expect(lru.get("q")).toBe("page");
    now = 1060;
    expect(lru.get("q")).toBeUndefined();
    expect(lru.size).toBe(0);
  });
  test("re-setting a key replaces its value and stamp", () => {
    let now = 0;
    const lru = new LRU<number>({ maxEntries: 2, ttlMs: 10, now: () => now });
    lru.set("a", 1); now = 8; lru.set("a", 2); now = 15;
    expect(lru.get("a")).toBe(2);
  });
});
