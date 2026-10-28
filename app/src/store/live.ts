import type { LiveArtifact, LiveControl, LiveEvent, LiveIntent, LiveReceipt, LiveServerMessage } from "../../../shared/live";
import { newId } from "../lib/id";
import { createStore } from "./createStore";
import { flowMode, flowTrace } from "../lib/flow-trace";
import { acceptsGeneration } from "../lib/generative-stream";

/**
 * Live surface state, per Dash conversation. The fast lane belongs to the Hermes chat it was
 * opened from: `parentSessionId` is the Hermes session of record, `workerId` the libfx worker.
 */
export interface LiveLine {
  id: string;
  role: "owner" | "worker" | "hermes" | "note";
  text: string;
  state: "streaming" | "done" | "error";
  /** A tool ran since the last text: the next text starts a new paragraph. */
  broken?: boolean;
  generation?: number;
}

export interface LiveTiming {
  sentAt: number;
  firstCharAt?: number;
  firstHtmlAt?: number;
  doneAt?: number;
}

export interface LiveState {
  generation?: number;
  open: boolean;
  status: "idle" | "opening" | "ready" | "error";
  error?: string;
  workerId?: string;
  profileId?: string;
  parentSessionId?: string;
  parentTitle?: string;
  model?: string;
  lines: LiveLine[];
  artifacts: LiveArtifact[];
  shownVersion?: number;
  controls: LiveControl[];
  receipts: LiveReceipt[];
  busy: boolean;
  askHermes: boolean;
  timing?: LiveTiming;
}

export const EMPTY_LIVE: LiveState = { open: false, status: "idle", lines: [], artifacts: [], controls: [], receipts: [], busy: false, askHermes: false };

export const liveStore = createStore<Record<string, LiveState>>({});
/**
 * Request id → the surface operation it belongs to, so server events find their surface.
 * `workerId` is the worker the request was sent to (unknown for an open); `seq` is the last
 * accepted live_event sequence for the request, so replays cannot duplicate or reorder text.
 */
interface LiveRequest {
  conversationId: string;
  kind: "open" | "turn" | "receipts";
  lineId?: string;
  workerId?: string;
  seq: number;
  generation?: number;
}
const requests = new Map<string, LiveRequest>();
/** Conversation id → its newest open request; an older open's reply must not swap identity. */
const latestOpen = new Map<string, string>();

/** Whether another turn/intent request for this conversation is still in flight. */
function otherTurnPending(conversationId: string, exceptId: string): boolean {
  for (const [id, request] of requests) {
    if (id !== exceptId && request.kind === "turn" && request.conversationId === conversationId &&
        (!flowMode || request.generation === liveOf(conversationId).generation)) return true;
  }
  return false;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function update(conversationId: string, fn: (state: LiveState) => LiveState): void {
  liveStore.set(all => ({ ...all, [conversationId]: fn(all[conversationId] ?? EMPTY_LIVE) }));
}

export function liveOf(conversationId: string | undefined): LiveState {
  return (conversationId && liveStore.get()[conversationId]) || EMPTY_LIVE;
}

export function setLiveOpen(conversationId: string, open: boolean): void {
  update(conversationId, state => ({ ...state, open }));
}

export function setAskHermes(conversationId: string, askHermes: boolean): void {
  update(conversationId, state => ({ ...state, askHermes }));
}

export function showVersion(conversationId: string, version: number): void {
  update(conversationId, state => ({ ...state, shownVersion: version }));
}

export function beginOpen(conversationId: string): string {
  const id = newId();
  requests.set(id, { conversationId, kind: "open", seq: 0 });
  latestOpen.set(conversationId, id);
  update(conversationId, state => ({ ...state, open: true, status: "opening", error: undefined }));
  return id;
}

export function nextGeneration(conversationId: string): number | undefined {
  if (!flowMode) return undefined;
  const generation = (liveOf(conversationId).generation ?? 0) + 1;
  flowTrace.mark("gen.bump", conversationId, generation);
  flowTrace.mark("turn.commit", conversationId, generation);
  update(conversationId, state => ({ ...state, generation, artifacts: [], shownVersion: undefined, controls: [] }));
  return generation;
}

export function beginLiveTurn(conversationId: string, text: string, askHermes: boolean): string {
  const id = newId();
  const lineId = `w_${id}`;
  const generation = nextGeneration(conversationId);
  requests.set(id, { conversationId, kind: "turn", lineId, workerId: liveOf(conversationId).workerId, seq: 0, generation });
  update(conversationId, state => ({
    ...state, busy: true, askHermes: false,
    timing: { sentAt: now() },
    lines: [...state.lines, { id: `o_${id}`, role: "owner", text: askHermes ? `Ask Hermes: ${text}` : text, state: "done" }, { id: lineId, role: "worker", text: "", state: "streaming", generation }],
  }));
  return id;
}

export function beginIntent(conversationId: string, intent: LiveIntent): string {
  const id = newId();
  const lineId = `w_${id}`;
  const generation = nextGeneration(conversationId);
  requests.set(id, { conversationId, kind: "turn", lineId, workerId: liveOf(conversationId).workerId, seq: 0, generation });
  update(conversationId, state => ({
    ...state, busy: true,
    timing: { sentAt: now() },
    lines: [...state.lines, { id: `o_${id}`, role: "owner", text: `Picked ${intent.label ?? String(intent.value)}`, state: "done" }, { id: lineId, role: "worker", text: "", state: "streaming", generation }],
  }));
  return id;
}

export function beginReceipts(conversationId: string): string {
  const id = newId();
  requests.set(id, { conversationId, kind: "receipts", workerId: liveOf(conversationId).workerId, seq: 0 });
  return id;
}

function applyEvent(state: LiveState, lineId: string | undefined, event: LiveEvent, othersBusy: boolean): LiveState {
  const line = (fn: (l: LiveLine) => LiveLine) => ({ ...state, lines: state.lines.map(l => (l.id === lineId ? fn(l) : l)) });
  switch (event.type) {
    case "delta": {
      const timing = state.timing && !state.timing.firstCharAt ? { ...state.timing, firstCharAt: now() } : state.timing;
      return { ...line(l => ({ ...l, text: l.text + (l.broken && l.text ? "\n\n" : "") + event.text, broken: false })), timing };
    }
    case "artifact": {
      const artifacts = [...state.artifacts.filter(a => a.version !== event.artifact.version), event.artifact].sort((a, b) => a.version - b.version);
      const timing = state.timing && !state.timing.firstHtmlAt ? { ...state.timing, firstHtmlAt: now() } : state.timing;
      return { ...state, artifacts, shownVersion: event.artifact.version, timing };
    }
    case "control":
      return { ...state, controls: [...state.controls.filter(c => c.id !== event.control.id), event.control] };
    case "hermes": {
      const text = event.phase === "asking" ? `Asking Hermes: ${event.text ?? ""}` : event.phase === "answered" ? (event.text ?? "") : `Hermes is busy elsewhere: ${event.text ?? ""}`;
      return { ...state, lines: [...state.lines.filter(l => l.id !== `h_${lineId}_${event.phase}`), { id: `h_${lineId}_${event.phase}`, role: "hermes", text, state: event.phase === "refused" ? "error" : "done" }] };
    }
    case "receipt":
      return { ...state, receipts: [...state.receipts, event.receipt] };
    case "done": {
      const done = line(l => ({ ...l, state: "done" }));
      const lines = done.lines.filter(l => !(l.id === lineId && !l.text.trim()));
      // A newer turn still running owns busy and timing; an old completion must not settle it.
      if (othersBusy) return { ...done, lines };
      return { ...done, lines, busy: false, timing: state.timing ? { ...state.timing, doneAt: now() } : undefined };
    }
    case "error":
      return { ...line(l => ({ ...l, text: l.text || event.message, state: "error" })), busy: othersBusy };
    case "tool":
      return line(l => ({ ...l, broken: true }));
    case "status":
      return state;
  }
}

export function applyLiveMessage(message: LiveServerMessage): void {
  const request = requests.get(message.id);
  if (!request) return;
  const { conversationId, lineId } = request;
  switch (message.type) {
    case "live_opened":
      requests.delete(message.id);
      if (latestOpen.get(conversationId) !== message.id) return;
      latestOpen.delete(conversationId);
      update(conversationId, state => ({
        ...state, status: "ready", workerId: message.workerId, profileId: message.profileId, parentSessionId: message.parentSessionId,
        parentTitle: message.parentTitle, model: message.model, artifacts: message.artifacts, shownVersion: message.artifacts.at(-1)?.version,
      }));
      return;
    case "live_event": {
      if (request.workerId !== undefined && message.workerId !== request.workerId) return;
      if (message.seq <= request.seq) return;
      request.seq = message.seq;
      const terminal = message.event.type === "done" || message.event.type === "error";
      if (terminal) requests.delete(message.id);
      if (flowMode && request.generation !== undefined && !acceptsGeneration(liveOf(conversationId).generation ?? 0, request.generation)) {
        flowTrace.mark("genui.discard", conversationId, request.generation);
        return;
      }
      const othersBusy = terminal && otherTurnPending(conversationId, message.id);
      update(conversationId, state => applyEvent(state, lineId, message.event, othersBusy));
      return;
    }
    case "live_receipts":
      if (request.workerId !== undefined && message.workerId !== request.workerId) return;
      requests.delete(message.id);
      update(conversationId, state => ({ ...state, receipts: message.receipts }));
      return;
    case "live_error": {
      requests.delete(message.id);
      if (flowMode && request.generation !== undefined && !acceptsGeneration(liveOf(conversationId).generation ?? 0, request.generation)) {
        flowTrace.mark("genui.discard", conversationId, request.generation);
        return;
      }
      if (request.kind === "open") {
        if (latestOpen.get(conversationId) !== message.id) return;
        latestOpen.delete(conversationId);
        update(conversationId, state => ({ ...state, status: state.status === "opening" ? "error" : state.status, error: message.message }));
        return;
      }
      if (request.kind === "receipts") {
        // A failed history refresh reports the error but never cancels a live turn.
        update(conversationId, state => ({ ...state, error: message.message }));
        return;
      }
      const othersBusy = otherTurnPending(conversationId, message.id);
      update(conversationId, state => ({
        ...state, busy: othersBusy, error: message.message,
        lines: state.lines.map(l => (l.id === lineId ? { ...l, text: l.text || message.message, state: "error" } : l)),
      }));
      return;
    }
  }
}
