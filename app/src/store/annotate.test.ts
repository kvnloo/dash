import { beforeEach, expect, test } from "bun:test";
import { EMPTY_DRAWING } from "../lib/annotate/strokes";
import { addSegment, annotate, commitStroke, currentSink, enterAnnotation, exitAnnotation, finishSend, registerSink, type AnnotationSink } from "./annotate";

const sink = (label: string): AnnotationSink => ({ label, steerable: () => false, send: () => {} });
const line = { tool: "pen" as const, color: "accent" as const, pointer: "stylus" as const, points: [{ x: 0, y: 0, p: 0.5, t: 1 }, { x: 1, y: 1, p: 0.5, t: 2 }] };

beforeEach(() => { exitAnnotation(); });

test("root live voice sink remains pinned when another chat registers on navigation", () => {
  const voice = { ...sink("attached voice"), live: true };
  const offVoice = registerSink(voice);
  const offChat = registerSink(sink("different chat"));
  expect(currentSink()).toBe(voice); expect(annotate.get().sink).toBe("attached voice");
  offVoice(); expect(currentSink()?.label).toBe("different chat"); offChat();
});

test("newest sink wins and unregistering falls back", () => {
  const offChat = registerSink(sink("chat"));
  const offVoice = registerSink(sink("voice session"));
  expect(currentSink()?.label).toBe("voice session");
  expect(annotate.get().sink).toBe("voice session");
  offVoice();
  expect(currentSink()?.label).toBe("chat");
  expect(annotate.get().sink).toBe("chat");
  offChat();
  expect(currentSink()).toBeUndefined();
  expect(annotate.get().sink).toBeUndefined();
});

test("keep drawing stays in the mode with a fresh page; send exits", () => {
  enterAnnotation();
  commitStroke(line);
  addSegment({ id: "s", text: "this", start: 0, end: 5, source: "mic" });
  finishSend(true);
  expect(annotate.get()).toMatchObject({ active: true, drawing: EMPTY_DRAWING, segments: [], status: "sent" });
  commitStroke(line);
  finishSend(false);
  expect(annotate.get().active).toBe(false);
});

test("discard drops strokes and speech", () => {
  enterAnnotation();
  commitStroke(line);
  expect(annotate.get().drawing.strokes).toHaveLength(1);
  exitAnnotation();
  expect(annotate.get()).toMatchObject({ active: false, drawing: EMPTY_DRAWING, segments: [] });
});

test("confirmed send clears only its snapshot, not newer ink/words or their next id", () => {
  enterAnnotation(); commitStroke(line);
  addSegment({ id: "submitted", text: "first", start: 1, end: 2, source: "voice" });
  const submitted = { strokes: annotate.get().drawing.strokes, segments: annotate.get().segments };
  commitStroke(line);
  addSegment({ id: "new", text: "second", start: 3, end: 4, source: "voice" });
  finishSend(false, submitted);
  expect(annotate.get().active).toBe(true);
  expect(annotate.get().drawing.strokes.map(stroke => stroke.id)).toEqual([2]);
  expect(annotate.get().drawing.nextId).toBe(3);
  expect(annotate.get().drawing.past).toEqual([]);
  expect(annotate.get().segments.map(segment => segment.id)).toEqual(["new"]);
});

test("segments replace by id and age out after ten minutes", () => {
  addSegment({ id: "a", text: "old", start: 0, end: 1000, source: "voice" });
  addSegment({ id: "a", text: "new", start: 0, end: 1000, source: "voice" });
  expect(annotate.get().segments.map(s => s.text)).toEqual(["new"]);
  addSegment({ id: "b", text: "later", start: 700_000, end: 700_500, source: "voice" });
  expect(annotate.get().segments.map(s => s.id)).toEqual(["b"]);
});
