import { afterAll, beforeEach, expect, test } from "bun:test";
import { copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { EMPTY_DRAWING } from "../lib/annotate/strokes";
import { addSegment, annotate, commitStroke, currentSink, enterAnnotation, exitAnnotation, finishSend, registerSink, setPenMode, stylusButton, toggleAnnotation, type AnnotationSink } from "./annotate";

const sink = (label: string): AnnotationSink => ({ label, steerable: () => false, send: () => {} });
const line = { tool: "pen" as const, color: "accent" as const, pointer: "stylus" as const, points: [{ x: 0, y: 0, p: 0.5, t: 1 }, { x: 1, y: 1, p: 0.5, t: 2 }] };

// Bun caches a module by path and ignores URL queries, so a sibling copy forces
// a real second evaluation, the way Metro re-runs the module on Fast Refresh.
const copies: string[] = [];
async function freshAnnotate(tag: string): Promise<typeof import("./annotate")> {
  const file = join(import.meta.dir, `annotate.refresh-${tag}-${process.pid}.tmp.ts`);
  copyFileSync(join(import.meta.dir, "annotate.ts"), file);
  copies.push(file);
  return import(file);
}
afterAll(() => { for (const file of copies) rmSync(file, { force: true }); });

// Capture module evaluation before the test reset hook can mask a bad default.
const coldStartState = annotate.get();

beforeEach(() => { exitAnnotation(); stylusButton(false); setPenMode(false); });

test("cold start leaves annotation and S Pen mode inactive", () => {
  expect(coldStartState).toMatchObject({ active: false, penMode: false, buttonDown: false });
});

test("Fast Refresh re-evaluates annotation without restoring a prior open ink tray", async () => {
  // Distinct module URLs simulate Metro evaluating the module for two app runs.
  // Both are independent of the already-imported store and any saved session.
  const cold = await freshAnnotate("cold");
  expect(cold.annotate.get()).toMatchObject({ active: false, penMode: false });
  cold.enterAnnotation();
  cold.setPenMode(true);
  const priorSession = cold.annotate.get();
  expect(priorSession).toMatchObject({ active: true, penMode: true });

  const refreshed = await freshAnnotate("refresh");
  expect(refreshed.annotate).not.toBe(cold.annotate);
  expect(refreshed.annotate.get()).not.toBe(priorSession);
  expect(refreshed.annotate.get()).toMatchObject({ active: false, penMode: false, buttonDown: false });
  // The older store can remain alive during Fast Refresh, but must not be restored.
  expect(cold.annotate.get()).toBe(priorSession);
});

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

test("side-button toggles once per press and retains unsent ink and speech across Normal", () => {
  stylusButton(true);
  expect(annotate.get()).toMatchObject({ active: true, buttonDown: true, penMode: true });
  commitStroke(line);
  addSegment({ id: "kept", text: "note", start: 1, end: 2, source: "mic" });
  const originalDrawing = annotate.get().drawing;
  const originalSegments = annotate.get().segments;
  stylusButton(true);
  expect(annotate.get().active).toBe(true);
  stylusButton(false);
  expect(annotate.get().active).toBe(true);
  stylusButton(true);
  expect(annotate.get()).toMatchObject({ active: false, buttonDown: true, penMode: true });
  expect(annotate.get().drawing).toBe(originalDrawing);
  expect(annotate.get().segments).toBe(originalSegments);
  stylusButton(false);
  stylusButton(true);
  expect(annotate.get().active).toBe(true);
  expect(annotate.get().drawing.strokes).toHaveLength(1);
  expect(annotate.get().segments.map(segment => segment.text)).toEqual(["note"]);
});

test("pill toggle is available without native stylus events and does not discard the draft", () => {
  toggleAnnotation();
  expect(annotate.get().active).toBe(true);
  commitStroke(line);
  const drawing = annotate.get().drawing;
  toggleAnnotation();
  expect(annotate.get().active).toBe(false);
  expect(annotate.get().drawing).toBe(drawing);
  toggleAnnotation();
  expect(annotate.get().active).toBe(true);
  expect(annotate.get().drawing.strokes).toHaveLength(1);
});
