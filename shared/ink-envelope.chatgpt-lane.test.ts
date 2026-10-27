import { expect, test } from "bun:test";
import {
  INK_CONTEXT_SPEAKABLE,
  acceptEnvelope,
  createInkSequencer,
  parseInkEnvelope,
  type InkEnvelope,
} from "./ink-envelope";

const stream = {
  session_id: "s_01",
  capture_id: "capture-A",
  source_device: "s25_ultra",
};
const common = { v: 1, ...stream, sequence: 0, generation: 0, timestamp: 1_782_576_000_000 };

test("all six event types parse into versioned, capture-scoped envelopes", () => {
  const examples: unknown[] = [
    { ...common, event_type: "capture_open", payload: { width: 1440, height: 3120, image_ref: "media_ref" } },
    { ...common, event_type: "annotation_delta", payload: { shape: "pen", bbox: [0, 0.2, 1, 0.9], target_id: "stroke_1" } },
    { ...common, event_type: "annotation_undo", payload: { count: 2 } },
    { ...common, event_type: "annotation_commit", payload: { stroke_count: 2, image_ref: "media_2" } },
    { ...common, event_type: "capture_close", payload: {} },
    { ...common, event_type: "handoff", payload: { to: "desktop_1" } },
  ];
  for (const input of examples) {
    const parsed = parseInkEnvelope(input);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect<unknown>(parsed.value).toEqual(input);
      expect(parsed.value.v).toBe(1);
      expect(parsed.value.capture_id).toBe(stream.capture_id);
    }
  }
});

test("optional references, all ink shapes and normalized bounding-box endpoints parse", () => {
  for (const shape of ["pen", "highlighter", "arrow", "box", "circle"]) {
    const event = {
      ...common,
      event_type: "annotation_delta",
      payload: { shape, bbox: [0, 0, 1, 1] },
    };
    expect<unknown>(parseInkEnvelope(event)).toEqual({ ok: true, value: event });
  }
  for (const event of [
    { ...common, event_type: "capture_open", payload: { width: 1, height: 1 } },
    { ...common, event_type: "annotation_commit", payload: { stroke_count: 0 } },
    { ...common, event_type: "annotation_undo", payload: { count: 0 } },
  ]) {
    expect<unknown>(parseInkEnvelope(event)).toEqual({ ok: true, value: event });
  }
  expect(parseInkEnvelope({
    ...common,
    session_id: "x".repeat(64),
    event_type: "annotation_commit",
    payload: { stroke_count: 0, image_ref: "r".repeat(256) },
  }).ok).toBe(true);
});

test("inverted, oversized, nonnumeric and nonfinite bounding boxes are rejected", () => {
  const invalidBoxes: unknown[] = [
    [0.5, 0, 0.2, 1],
    [0, 0.8, 0.5, 0.1],
    [0, 0, 1.2, 1],
    [-0.01, 0, 1, 1],
    [0, 0, Number.NaN, 1],
    [0, 0, Number.POSITIVE_INFINITY, 1],
    ["0", 0, 1, 1],
    [0, 0, 1],
    [0, 0, 1, 1, 1],
    null,
  ];
  for (const bbox of invalidBoxes) {
    const parsed = parseInkEnvelope({ ...common, event_type: "annotation_delta", payload: { shape: "box", bbox } });
    expect(parsed.ok).toBe(false);
  }
});

test("invalid versions, ids, counters, timestamps and event types fail closed", () => {
  const capture = { ...common, event_type: "capture_close", payload: {} };
  const invalid: unknown[] = [
    null, [], "capture_close", {},
    { ...capture, v: 2 },
    { ...capture, v: "1" },
    { ...capture, session_id: "" },
    { ...capture, session_id: "../outside" },
    { ...capture, session_id: "x".repeat(65) },
    { ...capture, capture_id: "invalid.id" },
    { ...capture, source_device: "phone/a" },
    { ...capture, sequence: -1 },
    { ...capture, sequence: 1.5 },
    { ...capture, sequence: Number.MAX_SAFE_INTEGER + 1 },
    { ...capture, generation: -1 },
    { ...capture, generation: 0.1 },
    { ...capture, generation: Number.POSITIVE_INFINITY },
    { ...capture, timestamp: -1 },
    { ...capture, timestamp: Number.NaN },
    { ...capture, event_type: "annotation_replace" },
    { ...capture, event_type: "x".repeat(300) },
    { ...capture, unnecessary: true },
    { ...capture, payload: { hidden: true } },
  ];
  for (const input of invalid) {
    const parsed = parseInkEnvelope(input);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.length).toBeGreaterThan(0);
  }
});

test("invalid payloads, oversized strings and unknown keys are rejected per type", () => {
  const invalid: unknown[] = [
    { ...common, event_type: "capture_open", payload: { width: 0, height: 2 } },
    { ...common, event_type: "capture_open", payload: { width: Number.POSITIVE_INFINITY, height: 2 } },
    { ...common, event_type: "capture_open", payload: { width: 2, height: 2, image_ref: "a".repeat(300) } },
    { ...common, event_type: "capture_open", payload: { width: 2, height: 2, image_ref: null } },
    { ...common, event_type: "capture_open", payload: { width: 2, height: 2, bytes: "unauthorized" } },
    { ...common, event_type: "annotation_delta", payload: { shape: "eraser", bbox: [0, 0, 1, 1] } },
    { ...common, event_type: "annotation_delta", payload: { shape: "pen", bbox: [0, 0, 1, 1], target_id: "a".repeat(300) } },
    { ...common, event_type: "annotation_delta", payload: { shape: "pen", bbox: [0, 0, 1, 1], target_id: "stroke.dot" } },
    { ...common, event_type: "annotation_delta", payload: { shape: "pen", bbox: [0, 0, 1, 1], color: "red" } },
    { ...common, event_type: "annotation_undo", payload: { count: -1 } },
    { ...common, event_type: "annotation_undo", payload: { count: 1.25 } },
    { ...common, event_type: "annotation_commit", payload: { stroke_count: -1 } },
    { ...common, event_type: "annotation_commit", payload: { stroke_count: 0.5 } },
    { ...common, event_type: "annotation_commit", payload: { stroke_count: 1, image_ref: "z".repeat(300) } },
    { ...common, event_type: "capture_close", payload: [] },
    { ...common, event_type: "capture_close", payload: { image_ref: "unexpected" } },
    { ...common, event_type: "handoff", payload: { to: "a".repeat(300) } },
    { ...common, event_type: "handoff", payload: { to: "../desktop" } },
    { ...common, event_type: "handoff", payload: { to: "desktop", secret: true } },
    { ...common, event_type: "handoff", payload: null },
  ];
  for (const input of invalid) expect(parseInkEnvelope(input).ok).toBe(false);
});

test("sequencer emits exactly 1000 strict monotonic sequences across generations", () => {
  const sequencer = createInkSequencer(stream);
  for (let i = 0; i < 1000; i++) {
    const event = sequencer.next("capture_close", {}, Math.floor(i / 200), i);
    expect(event.sequence).toBe(i);
    expect(event.generation).toBe(Math.floor(i / 200));
    expect(event.session_id).toBe(stream.session_id);
    expect(parseInkEnvelope(event).ok).toBe(true);
  }
});

test("sequencer supports all payloads, validates each emission, and does not consume rejected events", () => {
  expect(() => createInkSequencer({ ...stream, session_id: "bad id" })).toThrow(TypeError);
  const sequencer = createInkSequencer(stream);
  expect(() => sequencer.next("annotation_delta", { shape: "circle", bbox: [0.5, 0, 0.2, 1] }, 0, 1)).toThrow(TypeError);
  expect(() => sequencer.next("capture_close", {}, -1, 1)).toThrow(TypeError);
  expect(() => sequencer.next("capture_open", { width: 10, height: 10 }, 0, Number.NaN)).toThrow(TypeError);
  expect(sequencer.next("capture_open", { width: 10, height: 10 }, 0, 1).sequence).toBe(0);
  expect(sequencer.next("annotation_delta", { shape: "arrow", bbox: [0, 0, 1, 1] }, 0, 2).sequence).toBe(1);
  expect(sequencer.next("annotation_undo", { count: 1 }, 0, 3).sequence).toBe(2);
  expect(sequencer.next("annotation_commit", { stroke_count: 1 }, 0, 4).sequence).toBe(3);
  expect(sequencer.next("capture_close", {}, 0, 5).sequence).toBe(4);
  expect(sequencer.next("handoff", { to: "desktop" }, 1, 6).sequence).toBe(5);
});

test("admission distinguishes accept, duplicate, out-of-order and stale-generation", () => {
  const seq = createInkSequencer(stream);
  const first = seq.next("capture_open", { width: 1, height: 1 }, 0, 0);
  const second = seq.next("capture_close", {}, 0, 1);
  const newer = seq.next("handoff", { to: "desktop" }, 1, 2);
  expect(acceptEnvelope(null, first)).toBe("accept");
  expect(acceptEnvelope({ sequence: 0, generation: 0 }, first)).toBe("duplicate");
  expect(acceptEnvelope({ sequence: 2, generation: 0 }, second)).toBe("out-of-order");
  expect(acceptEnvelope({ sequence: 0, generation: 1 }, second)).toBe("stale-generation");
  expect(acceptEnvelope({ sequence: 0, generation: 0 }, second)).toBe("accept");
  expect(acceptEnvelope({ sequence: 1, generation: 0 }, newer)).toBe("accept");
  expect(acceptEnvelope({ sequence: 2, generation: 0 }, { ...newer, sequence: 2 })).toBe("out-of-order");
  expect(acceptEnvelope({ sequence: 2, generation: 2 }, newer)).toBe("stale-generation");
});

test("quiet ink envelopes cannot be marked speakable", () => {
  expect(INK_CONTEXT_SPEAKABLE).toBe(false);
  const event: InkEnvelope = createInkSequencer(stream).next("annotation_commit", { stroke_count: 0 }, 0, 1);
  expect(event.event_type).toBe("annotation_commit");
});
