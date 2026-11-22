/**
 * z0live lane timeline (DA-077): the lanes a z0live call has attached to the current thread
 * (fast, small, large/meta, council; DA-024), what each is doing right now and what it last
 * handed back. Folded from lane records the broker appends to the same session JSONL that
 * `z0live-state.ts` reads. Dependency-free; the bridge folds, the app validates.
 *
 * Lane records (one JSON object per line, `ts` in Unix seconds or ISO 8601, like every broker event):
 *   {"type":"lane_attached","ts":…,"data":{"lane":"fast","name":"Fast","model":"gpt-5-mini"}}
 *   {"type":"lane_step","ts":…,"data":{"lane":"fast","step":"Reading the diff"}}
 *   {"type":"lane_handoff","ts":…,"data":{"lane":"fast","summary":"One line","result":"Full text"}}
 *   {"type":"lane_error","ts":…,"data":{"lane":"fast","message":"Rate limited"}}
 *   {"type":"lane_detached","ts":…,"data":{"lane":"fast"}}
 * A step or handoff for a lane that never attached attaches it with its id as the name.
 */

export type Z0LaneStatus = "working" | "idle" | "error";
export interface Z0LaneHandoff { summary: string; result: string; at: number }
export interface Z0Lane {
  id: string;
  name: string;
  model?: string;
  status: Z0LaneStatus;
  /** What the lane is doing now (working), or its last error (error). */
  step?: string;
  /** When the current status began: step start while working, handoff or error time otherwise. */
  since: number;
  handoff?: Z0LaneHandoff;
}
export interface Z0LiveLanes { sessionId: string; lanes: Z0Lane[]; updated: number; now: number }
export type Z0LiveLaneEvent =
  | { type: "lane_attached"; ts: number; lane: string; name?: string; model?: string }
  | { type: "lane_step"; ts: number; lane: string; step: string }
  | { type: "lane_handoff"; ts: number; lane: string; summary: string; result: string }
  | { type: "lane_error"; ts: number; lane: string; message: string }
  | { type: "lane_detached"; ts: number; lane: string };

/** Lanes outlive the 60 s call heartbeat window: a large lane can think for minutes between steps. */
export const Z0LANES_STALE_SECONDS = 15 * 60;
export const Z0LANES_MAX = 8;
export const Z0LANE_NAME_MAX = 40;
export const Z0LANE_MODEL_MAX = 80;
export const Z0LANE_STEP_MAX = 160;
export const Z0LANE_SUMMARY_MAX = 280;
export const Z0LANE_RESULT_MAX = 8000;

const SESSION = /^[A-Za-z0-9_-]{1,128}$/;
const LANE = /^[A-Za-z0-9][\w.:-]{0,63}$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function line(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function block(text: string, max: number): string {
  const trimmed = text.replace(/\r\n?/g, "\n").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clipped = line(value, max);
  return clipped ? clipped : undefined;
}

function timestamp(value: unknown): number {
  return typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) / 1000 : NaN;
}

/** One JSONL record as a lane event; anything else (call events, junk) is undefined. */
export function parseZ0LaneEvent(raw: unknown): Z0LiveLaneEvent | undefined {
  if (!record(raw) || typeof raw.type !== "string" || !raw.type.startsWith("lane_")) return undefined;
  const ts = timestamp(raw.ts);
  const data = record(raw.data) ? raw.data : {};
  const lane = data.lane;
  if (!Number.isFinite(ts) || typeof lane !== "string" || !LANE.test(lane)) return undefined;
  switch (raw.type) {
    case "lane_attached": {
      const name = text(data.name, Z0LANE_NAME_MAX);
      const model = text(data.model, Z0LANE_MODEL_MAX);
      return { type: "lane_attached", ts, lane, ...(name ? { name } : {}), ...(model ? { model } : {}) };
    }
    case "lane_step": {
      const step = text(data.step, Z0LANE_STEP_MAX);
      return step ? { type: "lane_step", ts, lane, step } : undefined;
    }
    case "lane_handoff": {
      const full = typeof data.result === "string" ? block(data.result, Z0LANE_RESULT_MAX) : "";
      const summary = text(data.summary, Z0LANE_SUMMARY_MAX) ?? (full ? line(full, Z0LANE_SUMMARY_MAX) : undefined);
      return summary ? { type: "lane_handoff", ts, lane, summary, result: full || summary } : undefined;
    }
    case "lane_error": {
      const message = text(data.message, Z0LANE_STEP_MAX) ?? "Lane failed";
      return { type: "lane_error", ts, lane, message };
    }
    case "lane_detached":
      return { type: "lane_detached", ts, lane };
    default:
      return undefined;
  }
}

/** Apply one lane event. Pure; returns a new list, oldest attachment first, at most Z0LANES_MAX. */
export function applyZ0LaneEvent(lanes: readonly Z0Lane[], event: Z0LiveLaneEvent): Z0Lane[] {
  if (event.type === "lane_detached") return lanes.filter(lane => lane.id !== event.lane);
  const index = lanes.findIndex(lane => lane.id === event.lane);
  if (index < 0 && lanes.length >= Z0LANES_MAX) return [...lanes];
  const base: Z0Lane = index >= 0 ? lanes[index]! : { id: event.lane, name: event.lane, status: "idle", since: event.ts };
  let next: Z0Lane;
  switch (event.type) {
    case "lane_attached":
      next = { ...base, ...(event.name ? { name: event.name } : {}), ...(event.model ? { model: event.model } : {}) };
      break;
    case "lane_step":
      next = { ...base, status: "working", step: event.step, since: base.status === "working" && base.step === event.step ? base.since : event.ts };
      break;
    case "lane_handoff": {
      const { step: _step, ...rest } = base;
      next = { ...rest, status: "idle", since: event.ts, handoff: { summary: event.summary, result: event.result, at: event.ts } };
      break;
    }
    case "lane_error":
      next = { ...base, status: "error", step: event.message, since: event.ts };
      break;
  }
  return index >= 0 ? lanes.map((lane, i) => (i === index ? next : lane)) : [...lanes, next];
}

/** Fold one session's JSONL tail into its lanes. `now` is Unix seconds. Ended or stale sessions have none. */
export function parseZ0LiveLanes(sessionId: string, jsonl: string, now: number): Z0LiveLanes {
  const empty: Z0LiveLanes = { sessionId: SESSION.test(sessionId) ? sessionId : "", lanes: [], updated: 0, now };
  if (!SESSION.test(sessionId)) return empty;
  let lanes: Z0Lane[] = [];
  let last = -Infinity;
  let ended = false;
  for (const row of jsonl.split("\n")) {
    if (!row.trim()) continue;
    let raw: unknown;
    try { raw = JSON.parse(row); } catch { continue; }
    if (!record(raw)) continue;
    const ts = timestamp(raw.ts);
    if (Number.isFinite(ts)) last = Math.max(last, ts);
    const data = record(raw.data) ? raw.data : {};
    if (data.session_end === true || (raw.type === "app_state" && data.source === "session_end")) ended = true;
    const event = parseZ0LaneEvent(raw);
    if (event) lanes = applyZ0LaneEvent(lanes, event);
  }
  if (ended || !Number.isFinite(last) || now - last > Z0LANES_STALE_SECONDS || last - now > Z0LANES_STALE_SECONDS) return empty;
  return { sessionId, lanes, updated: last, now };
}

function parseLane(value: unknown): Z0Lane | undefined {
  if (!record(value) || typeof value.id !== "string" || !LANE.test(value.id)) return undefined;
  const status = value.status;
  if (status !== "working" && status !== "idle" && status !== "error") return undefined;
  if (typeof value.since !== "number" || !Number.isFinite(value.since)) return undefined;
  const name = text(value.name, Z0LANE_NAME_MAX) ?? value.id;
  const model = text(value.model, Z0LANE_MODEL_MAX);
  const step = text(value.step, Z0LANE_STEP_MAX);
  const h = value.handoff;
  const handoff = record(h) && typeof h.at === "number" && Number.isFinite(h.at) ? (() => {
    const summary = text(h.summary, Z0LANE_SUMMARY_MAX);
    const result = typeof h.result === "string" ? block(h.result, Z0LANE_RESULT_MAX) : "";
    return summary ? { summary, result: result || summary, at: h.at } : undefined;
  })() : undefined;
  return { id: value.id, name, ...(model ? { model } : {}), status, ...(step && status !== "idle" ? { step } : {}), since: value.since, ...(handoff ? { handoff } : {}) };
}

/** Validate what the bridge sent; anything off-shape is "no lanes". */
export function parseZ0LiveLanesState(value: unknown): Z0LiveLanes {
  const none: Z0LiveLanes = { sessionId: "", lanes: [], updated: 0, now: 0 };
  if (!record(value) || typeof value.sessionId !== "string" || !Array.isArray(value.lanes)) return none;
  if (typeof value.updated !== "number" || typeof value.now !== "number") return none;
  if (value.sessionId && !SESSION.test(value.sessionId)) return none;
  const lanes: Z0Lane[] = [];
  for (const lane of value.lanes.slice(0, Z0LANES_MAX)) {
    const parsed = parseLane(lane);
    if (parsed && !lanes.some(existing => existing.id === parsed.id)) lanes.push(parsed);
  }
  return { sessionId: value.sessionId, lanes, updated: value.updated, now: value.now };
}
