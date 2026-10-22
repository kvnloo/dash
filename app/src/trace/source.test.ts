import { beforeEach, expect, mock, test } from "bun:test";
import { restoreChip, canUndo } from "./chip-state";

const disk = new Map<string, string>();
mock.module("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: async (key: string) => disk.get(key) ?? null,
  multiGet: async (keys: string[]) => keys.map(key => [key, disk.get(key) ?? null]),
  multiSet: async (entries: [string, string][]) => { for (const [key, value] of entries) disk.set(key, value); },
  multiRemove: async (keys: string[]) => { for (const key of keys) disk.delete(key); },
  setItem: async (key: string, value: string) => { disk.set(key, value); },
} }));
const { demoSnapshot, feedbackStore, latest, loadFeedback, record, traceStore, setTraceSnapshot, setTraceUnavailable, resetTraceFeed } = await import("./source");
const key = "dash.trace.feedback/v1";
beforeEach(() => { disk.clear(); feedbackStore.set({ records: [], loaded: false }); });

test("production feed starts with no rows and never falls back to the bundled demo", () => {
  resetTraceFeed(false);
  expect(traceStore.get().feed).toEqual({ phase: "unpaired" });
  resetTraceFeed(true);
  expect(traceStore.get().feed).toEqual({ phase: "connecting" });
  setTraceUnavailable("Live trace endpoint unavailable (HTTP 404)", 1000);
  expect(traceStore.get().feed).toEqual({ phase: "unavailable", reason: "Live trace endpoint unavailable (HTTP 404)", at: 1000, lastLiveAt: null });
});

test("outage discards private live rows, remembers when they were last live, and never persists them", () => {
  resetTraceFeed(true);
  setTraceSnapshot({ ...demoSnapshot, read: "private host evidence" }, 5000);
  expect(traceStore.get().feed.phase).toBe("live");
  setTraceUnavailable("Bridge unreachable", 9000);
  const feed = traceStore.get().feed;
  expect(feed).toEqual({ phase: "unavailable", reason: "Bridge unreachable", at: 9000, lastLiveAt: 5000 });
  expect(JSON.stringify(feed)).not.toContain("private host evidence");
  setTraceUnavailable("Bridge unreachable", 14000);
  expect(traceStore.get().feed).toMatchObject({ lastLiveAt: 5000 });
  expect(disk.size).toBe(0);
});

test("a row that appears in a later poll is reported as arrived and stays reported until the next arrival", () => {
  const [first, second, third] = demoSnapshot.rows;
  if (!first || !second || !third) throw new Error("demo needs three rows");
  resetTraceFeed(true);
  setTraceSnapshot({ ...demoSnapshot, rows: [first] }, 1);
  expect(traceStore.get().feed).toMatchObject({ phase: "live", arrived: [] });
  setTraceSnapshot({ ...demoSnapshot, rows: [first, second] }, 2);
  expect(traceStore.get().feed).toMatchObject({ arrived: [second.key], receivedAt: 2 });
  setTraceSnapshot({ ...demoSnapshot, rows: [first, second] }, 3);
  expect(traceStore.get().feed).toMatchObject({ arrived: [second.key], receivedAt: 3 });
  setTraceSnapshot({ ...demoSnapshot, rows: [third, first, second] }, 4);
  expect(traceStore.get().feed).toMatchObject({ arrived: [third.key] });
  setTraceUnavailable("Bridge unreachable", 5);
  setTraceSnapshot({ ...demoSnapshot, rows: [third, first, second] }, 6);
  expect(traceStore.get().feed).toMatchObject({ arrived: [] });
});

test("action and Lab decisions persist in the existing export schema, reload, and undo", async () => {
  await loadFeedback();
  record("action", "a", "do");
  record("action", "lab-card", "not_now");
  const saved = disk.get(key);
  expect(saved).toContain('"schema":"dash.trace.feedback/v1"');
  feedbackStore.set({ records: [], loaded: false });
  await loadFeedback();
  const records = feedbackStore.get().records;
  expect(latest(records, "action", "a")).toBe("do");
  expect(latest(records, "action", "lab-card")).toBe("not_now");
  const response = records.find(r => r.id === "a");
  expect(response).toBeDefined();
  if (!response) throw new Error("missing persisted response");
  const at = Date.parse(response.at);
  expect(restoreChip(response.value, at).phase).toBe("resolved");
  expect(canUndo(restoreChip(response.value, at), at + 5000)).toBe(false);
  record("action", "a", "undo");
  feedbackStore.set({ records: [], loaded: false });
  await loadFeedback();
  expect(restoreChip(latest(feedbackStore.get().records, "action", "a")).phase).toBe("idle");
  expect(feedbackStore.get().records).toHaveLength(2);
});
