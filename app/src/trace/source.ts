import AsyncStorage from "@react-native-async-storage/async-storage";
import { createStore } from "../store/createStore";
import bundled from "./snapshot.json";
import { parseTraceSnapshot, type TraceSnapshot } from "./model";

/**
 * Private live data lives only in memory. The screen polls authenticated HTTP;
 * offline/pairing changes restore the public bundled export, never a previous host's data.
 */
export const traceStore = createStore<{ snapshot: TraceSnapshot; origin: "bundled" | "bridge"; error: string }>({
  snapshot: parseTraceSnapshot(bundled),
  origin: "bundled",
  error: "",
});

export function setTraceSnapshot(snapshot: TraceSnapshot): void {
  traceStore.set({ snapshot, origin: "bridge", error: "" });
}

export function resetBundledTrace(error = ""): void {
  traceStore.set({ snapshot: parseTraceSnapshot(bundled), origin: "bundled", error });
}

/* ---------- owner responses (same contract as the prototype: dash.trace.feedback/v1) ---------- */

export type TraceDecision = "do" | "not_now";
export type FeedbackRecord = {
  schema: "dash.trace.feedback/v1";
  kind: "action" | "lab_pick";
  id: string;
  value: string;
  at: string;
};

const KEY = "dash.trace.feedback/v1";
export const feedbackStore = createStore<{ records: FeedbackRecord[]; loaded: boolean }>({ records: [], loaded: false });

function isRecord(v: unknown): v is FeedbackRecord {
  if (typeof v !== "object" || v === null) return false;
  const r: Record<string, unknown> = { ...v };
  return r.schema === KEY && (r.kind === "action" || r.kind === "lab_pick") && typeof r.id === "string" && typeof r.value === "string" && typeof r.at === "string";
}

export async function loadFeedback(): Promise<void> {
  if (feedbackStore.get().loaded) return;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const records = Array.isArray(parsed) ? parsed.filter(isRecord) : [];
    feedbackStore.set({ records, loaded: true });
  } catch {
    feedbackStore.set({ records: [], loaded: true });
  }
}

export function record(kind: FeedbackRecord["kind"], id: string, value: string): void {
  const next: FeedbackRecord = { schema: KEY, kind, id, value, at: new Date().toISOString() };
  const records = [...feedbackStore.get().records.filter((r) => !(r.kind === kind && r.id === id)), next];
  feedbackStore.set({ records, loaded: true });
  void AsyncStorage.setItem(KEY, JSON.stringify(records)).catch(() => {});
}

export function latest(records: FeedbackRecord[], kind: FeedbackRecord["kind"], id: string): string | undefined {
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const r = records[i];
    if (r && r.kind === kind && r.id === id) return r.value;
  }
  return undefined;
}
