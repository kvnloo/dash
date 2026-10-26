import { describe, expect, test } from "bun:test";
import { chatKey, type ChatSummary } from "../../../shared/protocol";
import type { Conversation } from "../model";
import { applyHead, conversationEntries, emptyList, mergePage, type OpCounter, type PagedList } from "./chat-index";

const NOW = 1_800_000_000_000;
function summary(n: number): ChatSummary {
  const sessionId = `s${n}`;
  return { key: chatKey({ hostId: "groot", kind: "codex", sessionId }), kind: "codex", sessionId, hostId: "groot", hostName: "groot", title: `chat ${n}`,
    startedAt: NOW - n * 1000, lastActivityAt: NOW - n * 1000, messageCount: 2, origin: "agentsview", chatable: true };
}
function loaded(count: number): PagedList {
  let list = emptyList();
  for (let start = 0; start < count; start += 500) {
    list = mergePage(list, { items: Array.from({ length: Math.min(500, count - start) }, (_, i) => summary(start + i)), next: "more", rev: 1 });
  }
  return list;
}
const local: Conversation[] = Array.from({ length: 200 }, (_, i) => ({ id: `c${i}`, harness: "omp", title: `c${i}`, createdAt: NOW, updatedAt: NOW - i, messages: [] }));

describe("chat index scale (O(page))", () => {
  test("a page and a head update cost O(page + local), independent of 20k loaded rows", () => {
    const entries = conversationEntries(local);
    const big = loaded(20_000);
    const counter: OpCounter = { n: 0 };
    const nextPage = { items: Array.from({ length: 50 }, (_, i) => summary(20_000 + i)), next: "more", rev: 2 };
    const afterPage = mergePage(big, nextPage, counter);
    const head = { items: [{ ...summary(-1), key: "fresh", sessionId: "fresh", lastActivityAt: NOW + 10 }, ...Array.from({ length: 49 }, (_, i) => summary(i))], next: "more", rev: 3 };
    applyHead(afterPage, head, counter);
    const c = 4;
    expect(counter.n).toBeLessThanOrEqual(c * (50 + 50 + entries.length));
  });
  test("applying a page at 20k loaded takes less than 3x the time at 1k", () => {
    const time = (count: number) => {
      let list = loaded(count);
      const start = performance.now();
      for (let iter = 0; iter < 200; iter++) {
        const base = count + iter * 50;
        list = mergePage(list, { items: Array.from({ length: 50 }, (_, i) => summary(base + i)), next: "more", rev: 2 });
        list = applyHead(list, { items: Array.from({ length: 50 }, (_, i) => ({ ...summary(i), title: `bumped ${iter}` })), next: "more", rev: 3 + iter });
      }
      return performance.now() - start;
    };
    time(1_000); // warm up
    const small = Math.min(time(1_000), time(1_000));
    const large = Math.min(time(20_000), time(20_000));
    expect(large).toBeLessThan(Math.max(small, 1) * 3);
  }, 30_000);
});
