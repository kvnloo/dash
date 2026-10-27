import { describe, expect, test } from "bun:test";
import { chatKey, type ChatSummary } from "../../../shared/protocol";
import type { Conversation } from "../model";
import { applyHead, conversationEntries, emptyList, groupLabeler, labelList, labelStats, listRows, mergeLocal, mergePage, type OpCounter, type PagedList, type RemoteLabeled } from "./chat-index";

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
    // Best of four interleaved runs per size, so one run slowed by a loaded full suite
    // cannot decide the ratio. The 3x bound still rejects O(loaded) (20x more rows).
    const smalls: number[] = [];
    const larges: number[] = [];
    for (let run = 0; run < 4; run++) {
      smalls.push(time(1_000));
      larges.push(time(20_000));
    }
    const small = Math.min(...smalls);
    const large = Math.min(...larges);
    expect(large).toBeLessThan(Math.max(small, 1) * 3);
  }, 30_000);

  // What the Chats pane runs per version: label the list, then merge the local conversations in.
  // (listRows is not on that path; the append test below includes it, where it is O(page) too.)
  const groupOf = groupLabeler(NOW);
  const entries = conversationEntries(local);
  /** Rows an hour apart: 20k loaded spans about two years of month sections. */
  function hourly(n: number): ChatSummary {
    return { ...summary(n), startedAt: NOW - n * 3_600_000, lastActivityAt: NOW - n * 3_600_000 };
  }
  function loadedHourly(count: number): PagedList {
    let list = emptyList();
    for (let start = 0; start < count; start += 500) list = mergePage(list, { items: Array.from({ length: Math.min(500, count - start) }, (_, i) => hourly(start + i)), next: "more", rev: 1 });
    return list;
  }
  function pipeline(list: PagedList, prev: RemoteLabeled | undefined, flat = false): RemoteLabeled {
    if (flat) listRows(list);
    const labeled = labelList(list, groupOf, prev);
    if (mergeLocal(labeled, { local: entries, exhausted: false, groupOf }).length === 0) throw new Error("empty");
    return labeled;
  }
  function median(values: number[]): number {
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[sorted.length >> 1] ?? 0;
  }

  test("a head refresh that changes rows in place relabels O(changes), not O(loaded): near-constant at 1k and 20k", () => {
    const time = (count: number) => {
      let list = loadedHourly(count);
      let labeled = pipeline(list, undefined);
      const before = { ...labelStats };
      const samples: number[] = [];
      for (let iter = 0; iter < 60; iter++) {
        // Active chats: message counts tick, running flips, activity time unchanged.
        const items = Array.from({ length: 50 }, (_, i) => ({ ...hourly(i), messageCount: 2 + iter, running: iter % 2 === 0 }));
        const start = performance.now();
        list = applyHead(list, { items, next: "more", rev: 10 + iter });
        labeled = pipeline(list, labeled);
        samples.push(performance.now() - start);
      }
      expect(labelStats.full).toBe(before.full);
      expect(labelStats.patched - before.patched).toBe(60 * 50);
      return median(samples);
    };
    time(1_000); // warm up
    // Best of four interleaved runs per size, so one run slowed by a loaded full suite
    // cannot decide the ratio. The 3x bound still rejects O(loaded) (20x more rows).
    const smalls: number[] = [];
    const larges: number[] = [];
    for (let run = 0; run < 4; run++) {
      smalls.push(time(1_000));
      larges.push(time(20_000));
    }
    const small = Math.min(...smalls);
    const large = Math.min(...larges);
    expect(large).toBeLessThan(Math.max(small, 0.05) * 3);
  }, 30_000);

  test("a bumped row and a new chat lift into the head without relabeling the body", () => {
    let list = loadedHourly(20_000);
    let labeled = pipeline(list, undefined);
    const before = { ...labelStats };
    const fresh = { ...hourly(-1), key: "fresh", sessionId: "fresh", lastActivityAt: NOW + 10 };
    const bumped = { ...hourly(30), lastActivityAt: NOW + 5 };
    list = applyHead(list, { items: [fresh, bumped, ...Array.from({ length: 48 }, (_, i) => hourly(i))], next: "more", rev: 99 });
    labeled = pipeline(list, labeled);
    expect(labelStats.full).toBe(before.full);
    expect(listRows(list).slice(0, 3).map(row => row.key)).toEqual(["fresh", hourly(30).key, hourly(0).key]);
    const rows = mergeLocal(labeled, { local: [], exhausted: false, groupOf });
    expect(rows.filter(row => row.type === "chat").map(row => row.key).slice(0, 3)).toEqual(["fresh", hourly(30).key, hourly(0).key]);
    expect(rows.filter(row => row.key === hourly(30).key)).toHaveLength(1);
  });

  test("appending a page costs O(page): the full pipeline per page is near-constant at 1k and 20k loaded", () => {
    const time = (count: number) => {
      let list = loadedHourly(count);
      let labeled = pipeline(list, undefined);
      const before = { ...labelStats };
      const samples: number[] = [];
      for (let iter = 0; iter < 60; iter++) {
        const base = count + iter * 50;
        const start = performance.now();
        list = mergePage(list, { items: Array.from({ length: 50 }, (_, i) => hourly(base + i)), next: "more", rev: 2 });
        labeled = pipeline(list, labeled, true);
        samples.push(performance.now() - start);
      }
      expect(labelStats.full).toBe(before.full);
      return median(samples);
    };
    time(1_000); // warm up
    // Best of four interleaved runs per size, so one run slowed by a loaded full suite
    // cannot decide the ratio. The 3x bound still rejects O(loaded) (20x more rows).
    const smalls: number[] = [];
    const larges: number[] = [];
    for (let run = 0; run < 4; run++) {
      smalls.push(time(1_000));
      larges.push(time(20_000));
    }
    const small = Math.min(...smalls);
    const large = Math.min(...larges);
    expect(large).toBeLessThan(Math.max(small, 0.05) * 3);
  }, 30_000);
});
