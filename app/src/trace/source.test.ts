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
const { feedbackStore, latest, loadFeedback, record, traceStore, setTraceSnapshot, resetBundledTrace } = await import("./source");
const key = "dash.trace.feedback/v1";
beforeEach(() => { disk.clear(); feedbackStore.set({ records: [], loaded: false }); });

test("offline/pairing reset drops old-host trace evidence and never persists private snapshot", () => {
  setTraceSnapshot({ ...traceStore.get().snapshot, read: "private host evidence" });
  expect(traceStore.get().origin).toBe("bridge");
  resetBundledTrace("Offline · bundled snapshot");
  expect(traceStore.get().origin).toBe("bundled");
  expect(traceStore.get().snapshot.read).not.toBe("private host evidence");
  expect(traceStore.get().error).toContain("Offline");
  expect(disk.size).toBe(0);
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
