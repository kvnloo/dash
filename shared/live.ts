// Live surface: the fast lane of a Hermes chat. A libfx worker (fx) attached to the Hermes
// session runs quick back-and-forth and ephemeral UI made with fx0's design tools; Hermes
// stays the owner of the conversation and receives a receipt for every worker turn and tap.
// The bridge talks to z0bridge (`--fx`) on the host; the phone never sees z0bridge or its token.
// Dependency-free: imported by both `bridge/` and `app/`.

/** One version of an fx0 design: a single self-contained HTML document, already wrapped in fx0's CSP. */
export interface LiveArtifact {
  kind: "html";
  version: number;
  bytes: number;
  sha256: string;
  title?: string;
  html: string;
  createdAt: number;
}

export type LiveControl =
  | { id: string; kind: "choice"; prompt: string; options: { id: string; label: string; detail?: string }[]; multiple?: boolean }
  | { id: string; kind: "slider"; prompt: string; min: number; max: number; step?: number; value?: number; unit?: string }
  | { id: string; kind: "confirm"; prompt: string; confirmLabel?: string; cancelLabel?: string; detail?: string }
  | { id: string; kind: "candidates"; prompt: string; candidates: { id: string; label: string; detail?: string; artifactVersion?: number }[] };

/** The owner's tap, returned as declared intent. */
export interface LiveIntent {
  controlId: string;
  value: string | number | boolean | string[];
  label?: string;
  artifactVersion?: number;
  surface?: string;
}

/** A receipt as the owning Hermes session holds it (state.db child record `fxw_<worker>`). */
export interface LiveReceipt {
  kind: "turn" | "intent" | "ask_hermes";
  summary: string;
  decisions: string[];
  artifacts: { version: number; sha256: string; bytes: number }[];
  at: number;
  hermes?: { child: string; messageId: number };
}

export type LiveEvent =
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "tool"; id: string; name?: string; status?: string }
  | { type: "artifact"; artifact: LiveArtifact }
  | { type: "control"; control: LiveControl }
  | { type: "hermes"; phase: "asking" | "answered" | "refused"; text?: string }
  | { type: "receipt"; receipt: LiveReceipt }
  | { type: "done"; stopReason: string }
  | { type: "error"; message: string };

export type LiveClientMessage =
  /** Attach a worker to this Hermes chat (creating the Hermes session through z0bridge when the chat has none). */
  | { type: "live_open"; id: string; profileId?: string; sessionId?: string }
  | { type: "live_turn"; id: string; workerId: string; profileId: string; text: string; askHermes?: boolean }
  | { type: "live_intent"; id: string; workerId: string; profileId: string; intent: LiveIntent; continue?: boolean }
  | { type: "live_receipts"; id: string; workerId: string; profileId: string };

export type LiveServerMessage =
  | { type: "live_opened"; id: string; workerId: string; profileId: string; parentSessionId: string; parentTitle?: string; model?: string; artifacts: LiveArtifact[] }
  | { type: "live_event"; id: string; seq: number; workerId: string; event: LiveEvent }
  | { type: "live_receipts"; id: string; workerId: string; receipts: LiveReceipt[] }
  | { type: "live_error"; id: string; message: string };

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): value is string => typeof value === "string";
const optStr = (value: unknown): value is string | undefined => value === undefined || typeof value === "string";
const id = (value: unknown): value is string => str(value) && ID.test(value);

export function parseLiveIntent(raw: unknown): LiveIntent | null {
  if (!isRecord(raw) || !str(raw.controlId) || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(raw.controlId)) return null;
  const v = raw.value;
  const ok = (str(v) && v.length > 0 && v.length <= 200) || (typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean"
    || (Array.isArray(v) && v.length > 0 && v.length <= 8 && v.every(item => str(item) && item.length <= 200));
  if (!ok || !optStr(raw.label) || !optStr(raw.surface)) return null;
  if (raw.artifactVersion !== undefined && (!Number.isSafeInteger(raw.artifactVersion) || (raw.artifactVersion as number) < 1)) return null;
  return {
    controlId: raw.controlId, value: v as LiveIntent["value"],
    ...(raw.label ? { label: raw.label.slice(0, 120) } : {}),
    ...(raw.artifactVersion !== undefined ? { artifactVersion: raw.artifactVersion as number } : {}),
    ...(raw.surface ? { surface: raw.surface.slice(0, 40) } : {}),
  };
}

export function parseLiveClientMessage(raw: unknown): LiveClientMessage | null {
  if (!isRecord(raw) || !id(raw.id)) return null;
  switch (raw.type) {
    case "live_open":
      return (raw.profileId === undefined || id(raw.profileId)) && (raw.sessionId === undefined || id(raw.sessionId))
        ? { type: "live_open", id: raw.id, profileId: raw.profileId, sessionId: raw.sessionId } : null;
    case "live_turn":
      return id(raw.workerId) && id(raw.profileId) && str(raw.text) && raw.text.trim().length > 0 && raw.text.length <= 20_000 && (raw.askHermes === undefined || typeof raw.askHermes === "boolean")
        ? { type: "live_turn", id: raw.id, workerId: raw.workerId, profileId: raw.profileId, text: raw.text, ...(raw.askHermes ? { askHermes: true } : {}) } : null;
    case "live_intent": {
      const intent = parseLiveIntent(raw.intent);
      return intent && id(raw.workerId) && id(raw.profileId) && (raw.continue === undefined || typeof raw.continue === "boolean")
        ? { type: "live_intent", id: raw.id, workerId: raw.workerId, profileId: raw.profileId, intent, ...(raw.continue ? { continue: true } : {}) } : null;
    }
    case "live_receipts":
      return id(raw.workerId) && id(raw.profileId) ? { type: "live_receipts", id: raw.id, workerId: raw.workerId, profileId: raw.profileId } : null;
    default:
      return null;
  }
}

function isArtifact(value: unknown): value is LiveArtifact {
  return isRecord(value) && value.kind === "html" && Number.isSafeInteger(value.version) && typeof value.bytes === "number" && str(value.sha256) && str(value.html) && typeof value.createdAt === "number" && optStr(value.title);
}

function isReceipt(value: unknown): value is LiveReceipt {
  return isRecord(value) && str(value.kind) && str(value.summary) && Array.isArray(value.decisions) && value.decisions.every(str) && Array.isArray(value.artifacts) && typeof value.at === "number";
}

function isEvent(value: unknown): value is LiveEvent {
  if (!isRecord(value) || !str(value.type)) return false;
  switch (value.type) {
    case "status": case "delta": return str(value.text);
    case "tool": return str(value.id);
    case "artifact": return isArtifact(value.artifact);
    case "control": return isRecord(value.control) && str(value.control.id) && str(value.control.kind) && str(value.control.prompt);
    case "hermes": return (value.phase === "asking" || value.phase === "answered" || value.phase === "refused") && optStr(value.text);
    case "receipt": return isReceipt(value.receipt);
    case "done": return str(value.stopReason);
    case "error": return str(value.message);
    default: return false;
  }
}

export function parseLiveServerMessage(raw: unknown): LiveServerMessage | null {
  if (!isRecord(raw) || !str(raw.id)) return null;
  switch (raw.type) {
    case "live_opened":
      return str(raw.workerId) && str(raw.profileId) && str(raw.parentSessionId) && optStr(raw.parentTitle) && optStr(raw.model) && Array.isArray(raw.artifacts) && raw.artifacts.every(isArtifact)
        ? { type: "live_opened", id: raw.id, workerId: raw.workerId, profileId: raw.profileId, parentSessionId: raw.parentSessionId, parentTitle: raw.parentTitle, model: raw.model, artifacts: raw.artifacts } : null;
    case "live_event":
      return typeof raw.seq === "number" && str(raw.workerId) && isEvent(raw.event) ? { type: "live_event", id: raw.id, seq: raw.seq, workerId: raw.workerId, event: raw.event } : null;
    case "live_receipts":
      return str(raw.workerId) && Array.isArray(raw.receipts) && raw.receipts.every(isReceipt) ? { type: "live_receipts", id: raw.id, workerId: raw.workerId, receipts: raw.receipts } : null;
    case "live_error":
      return str(raw.message) ? { type: "live_error", id: raw.id, message: raw.message } : null;
    default:
      return null;
  }
}
