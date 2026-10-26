import { describe, expect, test } from "bun:test";
import { chatKey, type ChatSummary } from "../../../shared/protocol";
import type { Conversation } from "../model";
import { conversationEntries, groupLabeler, labelRemote, labelStats, mergeLocal, mergeLocalAndRemote, type ChatListRow, type ConversationEntry, type MergeInput } from "./chat-index";

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 26, 12).getTime();

/** The single-pass merge this module shipped before the incremental one: the reference result. */
function referenceMerge(input: MergeInput): ChatListRow[] {
  const groupOf = input.groupOf ?? groupLabeler(input.now ?? Date.now());
  const attention: ConversationEntry[] = [];
  const timeline: ConversationEntry[] = [];
  const ended: ConversationEntry[] = [];
  const localKeys = new Set<string>();
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
  for (const entry of attention) push(entry.attention ?? "", { type: "chat", key: entry.key, local: entry });
  const remote = input.remote;
  const last = remote.at(-1);
  const cutoff = !input.exhausted && last ? last.lastActivityAt : -Infinity;
  let i = 0, j = 0;
  while (i < timeline.length || j < remote.length) {
    const r = remote[j];
    if (r && localKeys.has(r.key)) { j += 1; continue; }
    const l = timeline[i];
    if (l && l.updatedAt < cutoff) { i = timeline.length; continue; }
    if (l && (!r || l.updatedAt >= r.lastActivityAt)) { push(l.stale && input.endedLast ? "Ended" : groupOf(l.updatedAt), { type: "chat", key: l.key, local: l }); i += 1; }
    else if (r) { push(groupOf(r.lastActivityAt), { type: "chat", key: r.key, remote: r }); j += 1; }
  }
  for (const entry of ended) push("Ended", { type: "chat", key: entry.key, local: entry });
  return out;
}

/** Deterministic PRNG so a failure reproduces. */
function rng(seed: number) {
  let x = seed >>> 0 || 1;
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
      const first = labelRemote(remote.slice(0, cut), groupOf);
      const before = labelStats.appended;
      const extended = labelRemote(remote.slice(), groupOf, first);
      if (cut > 0) expect(labelStats.appended).toBe(before + 1);
      const expected = referenceMerge({ local, remote, exhausted, endedLast, groupOf });
      expect(JSON.stringify(mergeLocal(extended, { local, exhausted, endedLast, groupOf }))).toBe(JSON.stringify(expected));
      // The labeling it extended still answers for its own prefix.
      expect(JSON.stringify(mergeLocal(first, { local, exhausted, endedLast, groupOf }))).toBe(JSON.stringify(referenceMerge({ local, remote: remote.slice(0, cut), exhausted, endedLast, groupOf })));
    }
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
