import AsyncStorage from "@react-native-async-storage/async-storage";
import { createStore } from "../store/createStore";
import bundled from "./snapshot.json";
import { parseTraceSnapshot, type TraceSnapshot } from "./model";

/** Bundled sample export. Component Lab demo only; production Trace never renders it. */
export const demoSnapshot: TraceSnapshot = parseTraceSnapshot(bundled);

/**
 * Production Trace feed. Private live data lives only in memory and is discarded on
 * pairing changes and outages; there is no sample fallback.
 */
export type TraceFeed =
  | { phase: "unpaired" }
  | { phase: "connecting" }
  | { phase: "live"; snapshot: TraceSnapshot; receivedAt: number; arrived: string[] }
  | { phase: "unavailable"; reason: string; at: number; lastLiveAt: number | null };

export const traceStore = createStore<{ feed: TraceFeed }>({ feed: { phase: "unpaired" } });

export function resetTraceFeed(paired: boolean): void {
  traceStore.set({ feed: paired ? { phase: "connecting" } : { phase: "unpaired" } });
}

/** Rows that appeared since the previous live poll; empty on the first load after a gap. */
export function setTraceSnapshot(snapshot: TraceSnapshot, now = Date.now()): void {
  const previous = traceStore.get().feed;
  const known = previous.phase === "live" ? new Set(previous.snapshot.rows.map(r => r.key)) : null;
  const fresh = known ? snapshot.rows.filter(r => !known.has(r.key)).map(r => r.key) : [];
  const arrived = previous.phase === "live" && !fresh.length ? previous.arrived : fresh;
  traceStore.set({ feed: { phase: "live", snapshot, receivedAt: now, arrived } });
}

export function setTraceUnavailable(reason: string, now = Date.now()): void {
  const previous = traceStore.get().feed;
  const lastLiveAt = previous.phase === "live" ? previous.receivedAt : previous.phase === "unavailable" ? previous.lastLiveAt : null;
  traceStore.set({ feed: { phase: "unavailable", reason, at: now, lastLiveAt } });
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
