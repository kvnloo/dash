/**
 * Versioned, capture-scoped ink events shared by the phone and bridge.
 * image_ref is a reference to separately authorized media, never image bytes.
 * This module does not authorize screen capture, transport, or voice output.
 */

export type InkEventType =
  | "capture_open"
  | "annotation_delta"
  | "annotation_undo"
  | "annotation_commit"
  | "capture_close"
  | "handoff";

export type InkShape = "pen" | "highlighter" | "arrow" | "box" | "circle";
export type InkBoundingBox = [x0: number, y0: number, x1: number, y1: number];

export interface InkPayloadByType {
  capture_open: { width: number; height: number; image_ref?: string };
  annotation_delta: { shape: InkShape; bbox: InkBoundingBox; target_id?: string };
  annotation_undo: { count: number };
  annotation_commit: { stroke_count: number; image_ref?: string };
  capture_close: Record<string, never>;
  handoff: { to: string };
}

export interface InkSourceIdentity {
  session_id: string;
  capture_id: string;
  source_device: string;
}

interface InkEnvelopeBase extends InkSourceIdentity {
  v: 1;
  sequence: number;
  generation: number;
  timestamp: number;
}

export type InkEnvelopeFor<E extends InkEventType> = InkEnvelopeBase & {
  event_type: E;
  payload: InkPayloadByType[E];
};

export type InkEnvelope = {
  [E in InkEventType]: InkEnvelopeFor<E>;
}[InkEventType];

export type InkEnvelopeParseResult =
  | { ok: true; value: InkEnvelope }
  | { ok: false; error: string };

/** Ink is quiet session context, never a speakable transcript segment. */
export const INK_CONTEXT_SPEAKABLE = false;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_STRING_LENGTH = 256;
const ENVELOPE_FIELDS = [
  "v", "session_id", "capture_id", "source_device", "sequence",
  "generation", "event_type", "payload", "timestamp",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactFields(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  return required.every(key => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}

function isInkId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function isOptionalId(value: unknown): value is string | undefined {
  return value === undefined || isInkId(value);
}

function isOptionalText(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length <= MAX_STRING_LENGTH);
}

function isCounter(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isInkShape(value: unknown): value is InkShape {
  return value === "pen" || value === "highlighter" || value === "arrow"
    || value === "box" || value === "circle";
}

function parseBoundingBox(value: unknown): InkBoundingBox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const x0: unknown = value[0];
  const y0: unknown = value[1];
  const x1: unknown = value[2];
  const y1: unknown = value[3];
  const coordinate = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
  if (!coordinate(x0) || !coordinate(y0) || !coordinate(x1) || !coordinate(y1)) return null;
  if (x0 > x1 || y0 > y1) return null;
  return [x0, y0, x1, y1];
}

function reject(error: string): InkEnvelopeParseResult {
  return { ok: false, error };
}

/** Fail-closed parser. Rebuilds the envelope instead of trusting arbitrary input keys. */
export function parseInkEnvelope(raw: unknown): InkEnvelopeParseResult {
  if (!isRecord(raw) || !hasExactFields(raw, ENVELOPE_FIELDS)) {
    return reject("Ink envelope must have exactly the required fields");
  }
  if (raw.v !== 1) return reject("Unsupported ink envelope version");
  if (!isInkId(raw.session_id) || !isInkId(raw.capture_id) || !isInkId(raw.source_device)) {
    return reject("Invalid session, capture, or source device id");
  }
  if (!isCounter(raw.sequence) || !isCounter(raw.generation)) {
    return reject("Sequence and generation must be nonnegative safe integers");
  }
  if (!isTimestamp(raw.timestamp)) return reject("Timestamp must be a finite nonnegative number");

  const common: InkEnvelopeBase = {
    v: 1,
    session_id: raw.session_id,
    capture_id: raw.capture_id,
    source_device: raw.source_device,
    sequence: raw.sequence,
    generation: raw.generation,
    timestamp: raw.timestamp,
  };

  const payload = raw.payload;
  switch (raw.event_type) {
    case "capture_open":
      if (!isRecord(payload) || !hasExactFields(payload, ["width", "height"], ["image_ref"])
        || !isPositiveFinite(payload.width) || !isPositiveFinite(payload.height)
        || !isOptionalText(payload.image_ref)) {
        return reject("Invalid capture_open payload");
      }
      return {
        ok: true,
        value: {
          ...common,
          event_type: "capture_open",
          payload: {
            width: payload.width,
            height: payload.height,
            ...(payload.image_ref === undefined ? {} : { image_ref: payload.image_ref }),
          },
        },
      };

    case "annotation_delta": {
      if (!isRecord(payload) || !hasExactFields(payload, ["shape", "bbox"], ["target_id"])
        || !isInkShape(payload.shape) || !isOptionalId(payload.target_id)) {
        return reject("Invalid annotation_delta payload");
      }
      const bbox = parseBoundingBox(payload.bbox);
      if (bbox === null) return reject("Invalid normalized annotation bounding box");
      return {
        ok: true,
        value: {
          ...common,
          event_type: "annotation_delta",
          payload: {
            shape: payload.shape,
            bbox,
            ...(payload.target_id === undefined ? {} : { target_id: payload.target_id }),
          },
        },
      };
    }

    case "annotation_undo":
      if (!isRecord(payload) || !hasExactFields(payload, ["count"])
        || !isCounter(payload.count) || payload.count < 1) {
        return reject("Invalid annotation_undo count");
      }
      return {
        ok: true,
        value: { ...common, event_type: "annotation_undo", payload: { count: payload.count } },
      };

    case "annotation_commit":
      if (!isRecord(payload) || !hasExactFields(payload, ["stroke_count"], ["image_ref"])
        || !isCounter(payload.stroke_count) || !isOptionalText(payload.image_ref)) {
        return reject("Invalid annotation_commit payload");
      }
      return {
        ok: true,
        value: {
          ...common,
          event_type: "annotation_commit",
          payload: {
            stroke_count: payload.stroke_count,
            ...(payload.image_ref === undefined ? {} : { image_ref: payload.image_ref }),
          },
        },
      };

    case "capture_close":
      if (!isRecord(payload) || !hasExactFields(payload, [])) {
        return reject("Invalid capture_close payload");
      }
      return { ok: true, value: { ...common, event_type: "capture_close", payload: {} } };

    case "handoff":
      if (!isRecord(payload) || !hasExactFields(payload, ["to"]) || !isInkId(payload.to)) {
        return reject("Invalid handoff destination");
      }
      return { ok: true, value: { ...common, event_type: "handoff", payload: { to: payload.to } } };

    default:
      return reject("Unknown ink event type");
  }
}

/**
 * Generates monotonic sequences for one session/capture/device stream.
 * A rejected event does not consume its sequence number.
 */
export function createInkSequencer(base: InkSourceIdentity) {
  if (!isInkId(base.session_id) || !isInkId(base.capture_id) || !isInkId(base.source_device)) {
    throw new TypeError("Invalid ink stream identity");
  }
  const identity: InkSourceIdentity = {
    session_id: base.session_id,
    capture_id: base.capture_id,
    source_device: base.source_device,
  };
  let sequence = 0;
  return {
    next<E extends InkEventType>(
      event_type: E,
      payload: InkPayloadByType[E],
      generation: number,
      timestamp: number,
    ): InkEnvelopeFor<E> {
      if (!Number.isSafeInteger(sequence)) throw new RangeError("Ink sequence exhausted");
      const envelope: InkEnvelopeFor<E> = {
        ...identity,
        v: 1,
        sequence,
        generation,
        event_type,
        payload,
        timestamp,
      };
      const parsed = parseInkEnvelope(envelope);
      if (!parsed.ok) throw new TypeError(parsed.error);
      sequence += 1;
      return envelope;
    },
  };
}

export type InkEnvelopeDecision =
  | "accept"
  | "duplicate"
  | "out-of-order"
  | "stale-generation";

/**
 * Call with the last accepted sequence/generation for this capture stream.
 * A newer generation does not waive the stream-wide monotonic sequence rule.
 */
export function acceptEnvelope(
  last: { sequence: number; generation: number } | null,
  env: InkEnvelope,
): InkEnvelopeDecision {
  if (last === null) return "accept";
  if (env.generation < last.generation) return "stale-generation";
  if (env.sequence === last.sequence && env.generation === last.generation) return "duplicate";
  if (env.sequence <= last.sequence) return "out-of-order";
  return "accept";
}
