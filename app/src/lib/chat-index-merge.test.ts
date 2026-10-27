import { describe, expect, test } from "bun:test";
import { chatKey, type ChatSummary } from "../../../shared/protocol";
import type { Conversation } from "../model";
import { applyHead, conversationEntries, emptyList, groupLabeler, labelList, labelRemote, labelStats, listRows, mergeLocal, mergeLocalAndRemote, mergePage, type ChatListRow, type ConversationEntry, type MergeInput, type PagedList } from "./chat-index";

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 26, 12).getTime();

/** The single-pass merge this module shipped before the incremental one: the reference result. */
function referenceMerge(input: MergeInput): ChatListRow[] {
  const groupOf = input.groupOf ?? groupLabeler(input.now ?? Date.now());
  const attention: ConversationEntry[] = [];
  const timeline: ConversationEntry[] = [];
  const ended: ConversationEntry[] = [];
  const localKeys = new Set<string>();
  const keyCount = new Map<string, number>();
  for (const entry of input.local) keyCount.set(entry.key, (keyCount.get(entry.key) ?? 0) + 1);
  const rowKey = (entry: ConversationEntry) => (keyCount.get(entry.key) ?? 0) > 1 ? `${entry.key}#${entry.id}` : entry.key;
  for (const entry of input.local) {
    localKeys.add(entry.key);
    if (entry.attention) attention.push(entry);
    else if (entry.stale && input.endedLast) ended.push(entry);
    else timeline.push(entry);
  }
  attention.sort((a, b) => (a.attention === b.attention ? 0 : a.attention === "Needs attention" ? -1 : 1) || b.updatedAt - a.updatedAt);
  timeline.sort((a, b) => b.updatedAt - a.updatedAt);
  ended.sort((a, b) => b.updatedAt - a.updatedAt);
  const out: ChatListRow[] = [];
  let section: { type: "section"; key: string; title: string; count: number } | undefined;
  const used = new Map<string, number>();
  const push = (title: string, row: ChatListRow) => {
    if (section?.title !== title) {
      const seen = used.get(title) ?? 0;
      used.set(title, seen + 1);
      section = { type: "section", key: seen ? `sec-${title}-${seen}` : `sec-${title}`, title, count: 0 };
      out.push(section);
    }
    section.count += 1;
    out.push(row);
  };
  for (const entry of attention) push(entry.attention ?? "", { type: "chat", key: rowKey(entry), local: entry });
  const remote = input.remote;
  const last = remote.at(-1);
  const cutoff = !input.exhausted && last ? last.lastActivityAt : -Infinity;
  let i = 0, j = 0;
  while (i < timeline.length || j < remote.length) {
    const r = remote[j];
    if (r && localKeys.has(r.key)) { j += 1; continue; }
    const l = timeline[i];
    if (l && l.updatedAt < cutoff) { i = timeline.length; continue; }
    if (l && (!r || l.updatedAt >= r.lastActivityAt)) { push(l.stale && input.endedLast ? "Ended" : groupOf(l.updatedAt), { type: "chat", key: rowKey(l), local: l }); i += 1; }
    else if (r) { push(groupOf(r.lastActivityAt), { type: "chat", key: r.key, remote: r }); j += 1; }
  }
  for (const entry of ended) push("Ended", { type: "chat", key: rowKey(entry), local: entry });
  return out;
}

/** Deterministic PRNG so a failure reproduces. */
function rng(seed: number) {
  // Mix the seed: xorshift's first outputs for small seeds are near 0 (every list came out empty).
  let x = Math.imul(seed, 0x9e3779b1) >>> 0 || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 0x1_0000_0000; };
}

function summary(n: number, at: number): ChatSummary {
  const sessionId = `s${n}`;
  return { key: chatKey({ hostId: "groot", kind: "codex", sessionId }), kind: "codex", sessionId, hostId: "groot", hostName: "groot", title: `chat ${n}`,
    startedAt: at, lastActivityAt: at, messageCount: 2, origin: "agentsview", chatable: true };
}

function scenario(seed: number) {
  const rand = rng(seed);
  const remoteCount = Math.floor(rand() * 60);
  // Mostly the past few months, some ties, a few in the future (labels that are not monotonic).
  const times = Array.from({ length: remoteCount }, () => rand() < 0.05 ? NOW + Math.floor(rand() * DAY) : NOW - Math.floor(rand() * rand() * 120) * DAY / 4);
  times.sort((a, b) => b - a);
  const remote = times.map((at, n) => summary(n, at));
  const conversations: Conversation[] = Array.from({ length: Math.floor(rand() * 12) }, (_, k) => {
    const shadow = remote.length && rand() < 0.4 ? remote[Math.floor(rand() * remote.length)] : undefined;
    const updatedAt = rand() < 0.2 && remote.length ? remote[Math.floor(rand() * remote.length)]?.lastActivityAt ?? NOW : NOW - Math.floor(rand() * 90 * DAY);
    const roll = rand();
    return {
      id: `c${k}`, harness: shadow ? "codex" : "omp", title: `local ${k}`, createdAt: NOW, updatedAt,
      ...(shadow ? { sessionId: shadow.sessionId, targetHostId: "groot" } : {}),
      ...(roll < 0.15 ? { stale: true } : {}),
      messages: roll > 0.85 ? [{ id: `m${k}`, role: "assistant", text: "", at: updatedAt, state: rand() < 0.5 ? "streaming" : "error", turnId: "t", seq: 0 }] : [],
    } satisfies Conversation;
  });
  return { remote, local: conversationEntries(conversations), exhausted: rand() < 0.5, endedLast: rand() < 0.5 };
}

describe("incremental merge", () => {
  test("a local change re-merges in O(L log N) plus one copy: far cheaper than a full merge at 10k loaded rows", () => {
    const groupOf = groupLabeler(NOW);
    const remote = Array.from({ length: 10_000 }, (_, n) => summary(n, NOW - n * 600_000));
    const labeled = labelRemote(remote, groupOf);
    const local = conversationEntries(Array.from({ length: 40 }, (_, k): Conversation => ({ id: `l${k}`, harness: "omp", title: `l${k}`, createdAt: NOW, updatedAt: NOW - k * 3_600_000, messages: [] })));
    const time = (fn: () => unknown) => {
      for (let i = 0; i < 5; i++) fn();
      const start = performance.now();
      for (let i = 0; i < 20; i++) fn();
      return performance.now() - start;
    };
    const incremental = Math.min(time(() => mergeLocal(labeled, { local, exhausted: false, groupOf })), time(() => mergeLocal(labeled, { local, exhausted: false, groupOf })));
    const full = Math.min(time(() => referenceMerge({ local, remote, exhausted: false, groupOf })), time(() => referenceMerge({ local, remote, exhausted: false, groupOf })));
    expect(incremental * 4).toBeLessThan(full);
  }, 60_000);

  test("matches the single-pass merge on 400 random lists (drops, ties, cutoff, ended, future times)", () => {
    const groupOf = groupLabeler(NOW);
    for (let seed = 1; seed <= 400; seed++) {
      const { remote, local, exhausted, endedLast } = scenario(seed);
      const expected = referenceMerge({ local, remote, exhausted, endedLast, groupOf });
      const got = mergeLocalAndRemote({ local, remote, exhausted, endedLast, groupOf });
      if (JSON.stringify(got) !== JSON.stringify(expected)) throw new Error(`seed ${seed}: ${JSON.stringify(got.map(r => r.key))} != ${JSON.stringify(expected.map(r => r.key))}`);
    }
  });

  test("an appended page labels only the new rows and matches a full labeling", () => {
    const groupOf = groupLabeler(NOW);
    for (let seed = 1; seed <= 100; seed++) {
      const { remote, local, exhausted, endedLast } = scenario(seed);
      const cut = Math.floor(remote.length / 2);
      const firstList = mergePage(emptyList(), { items: remote.slice(0, cut), next: "c", rev: 1 });
      const first = labelList(firstList, groupOf);
      expect(JSON.stringify(mergeLocal(first, { local, exhausted, endedLast, groupOf }))).toBe(JSON.stringify(referenceMerge({ local, remote: remote.slice(0, cut), exhausted, endedLast, groupOf })));
      const before = { ...labelStats };
      const extended = labelList(mergePage(firstList, { items: remote.slice(cut), next: null, rev: 1 }), groupOf, first);
      if (cut > 0 && cut < remote.length) expect(labelStats.appended).toBe(before.appended + 1);
      expect(labelStats.full).toBe(before.full);
      const expected = referenceMerge({ local, remote, exhausted, endedLast, groupOf });
      expect(JSON.stringify(mergeLocal(extended, { local, exhausted, endedLast, groupOf }))).toBe(JSON.stringify(expected));
    }
  });

  test("random page and head sequences: the incremental labeling matches a fresh one and the single-pass merge", () => {
    const groupOf = groupLabeler(NOW);
    let checked = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const rand = rng(seed * 7919);
      const { local, exhausted, endedLast } = scenario(seed);
      const pool = Array.from({ length: 80 }, (_, n) => summary(n, NOW - Math.floor(rand() * 60) * DAY / 3 - n));
      pool.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
      let list: PagedList = emptyList();
      let labeled = labelList(list, groupOf);
      let offset = 0;
      for (let step = 0; step < 12; step++) {
        if (rand() < 0.5 && offset < pool.length) {
          const size = 1 + Math.floor(rand() * 10);
          list = mergePage(list, { items: pool.slice(offset, offset + size), next: "c", rev: step });
          offset += size;
        } else {
          // A fresh page 1: some rows change in place, some get bumped, sometimes a new chat.
          const top = listRows(list).slice(0, 8).map(row => {
            const roll = rand();
            if (roll < 0.3) return { ...row, messageCount: row.messageCount + 1 };
            if (roll < 0.45) return { ...row, lastActivityAt: NOW + step * 1000 + Math.floor(rand() * 500) };
            return row;
          });
          if (rand() < 0.3) top.unshift(summary(1000 + seed * 100 + step, NOW + step * 1000 + 999));
          top.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
          list = applyHead(list, { items: top, next: "c", rev: step });
        }
        labeled = labelList(list, groupOf, labeled);
        const remote = listRows(list);
        const fresh = labelRemote(remote, groupOf);
        const got = JSON.stringify(mergeLocal(labeled, { local, exhausted, endedLast, groupOf }));
        expect(got).toBe(JSON.stringify(mergeLocal(fresh, { local, exhausted, endedLast, groupOf })));
        // The single-pass reference assumes a sorted remote list; bumped rows keep it sorted.
        if (remote.every((row, i) => i === 0 || (remote[i - 1]?.lastActivityAt ?? 0) >= row.lastActivityAt)) {
          expect(got).toBe(JSON.stringify(referenceMerge({ local, remote, exhausted, endedLast, groupOf })));
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  test("phone chats that share one index key still get unique list keys (FlashList blank rows)", () => {
    const groupOf = groupLabeler(NOW);
    const remote = [summary(0, NOW - 3_600_000), summary(1, NOW - 7_200_000)];
    const shared = remote[0]!;
    // A bridge that reuses one session id: three phone chats resolve to the same host session key.
    const local = conversationEntries(["a", "b", "c"].map((id, k): Conversation => ({
      id, harness: "codex", title: id, createdAt: NOW, updatedAt: NOW - k * 60_000, messages: [],
      sessionId: shared.sessionId, targetHostId: "groot",
    })));
    expect(new Set(local.map(entry => entry.key)).size).toBe(1);
    const rows = mergeLocal(labelRemote(remote, groupOf), { local, exhausted: true, groupOf });
    const keys = rows.map(row => row.key);
    expect(new Set(keys).size).toBe(keys.length);
    const chats = rows.filter(row => row.type === "chat");
    expect(chats.filter(row => row.local).map(row => row.key)).toEqual([`${shared.key}#a`, `${shared.key}#b`, `${shared.key}#c`]);
    // The remote copy of the shared session is replaced, the unrelated remote row stays.
    expect(chats.filter(row => row.remote).map(row => row.key)).toEqual([remote[1]!.key]);
    // A key that is not shared keeps its plain form.
    const single = mergeLocal(labelRemote(remote, groupOf), { local: local.slice(0, 1), exhausted: true, groupOf });
    expect(single.filter(row => row.type === "chat" && row.local).map(row => row.key)).toEqual([shared.key]);
  });

  test("remote rows and untouched section headers keep their identity across local changes", () => {
    const groupOf = groupLabeler(NOW);
    const remote = Array.from({ length: 200 }, (_, n) => summary(n, NOW - n * 3_600_000));
    const labeled = labelRemote(remote, groupOf);
    const a = mergeLocal(labeled, { local: [], exhausted: false, groupOf });
    const running: Conversation = { id: "run", harness: "omp", title: "run", createdAt: NOW, updatedAt: NOW + 1, messages: [{ id: "m", role: "assistant", text: "", at: NOW, state: "streaming", turnId: "t", seq: 0 }] };
    const b = mergeLocal(labeled, { local: conversationEntries([running]), exhausted: false, groupOf });
    expect(b[0]).toMatchObject({ type: "section", title: "Running" });
    expect(b.slice(2)).toEqual(a);
    for (let k = 0; k < a.length; k++) expect(b[k + 2]).toBe(a[k]);
  });
});
