// Annotation mode state. One overlay for the whole app; screens register where a
// finished annotation goes (the open chat, or the live voice session).
import type { ChatAttachment } from "../../../shared/protocol";
import type { Segment } from "../lib/annotate/align";
import { EMPTY_DRAWING, addStroke, clear, eraseAlong, undo, type Drawing, type InkColor, type Stroke, type Tool } from "../lib/annotate/strokes";
import { penButton, toggleMode } from "../lib/stylus-mode";
import { createStore } from "./createStore";

export interface AnnotationPreview {
  /** data: URI of the composited PNG, shown before upload finishes. */
  image: string;
  text: string;
  strokes: number;
}

export interface AnnotateState {
  active: boolean;
  /** Current S Pen side-button latch, to ignore repeats until release. */
  buttonDown: boolean;
  /** Palm rejection: only the S Pen draws; fingers scroll. Persisted per app run. */
  penMode: boolean;
  tool: Tool;
  color: InkColor;
  drawing: Drawing;
  segments: Segment[];
  /** Hold-to-talk mic in the tray is recording. */
  recording: boolean;
  status: "idle" | "capturing" | "sending" | "sent" | "error";
  error?: string;
  preview?: AnnotationPreview;
  /** Which sink a Send will reach, for the tray label. */
  sink?: string;
  /** An unconfirmed voice annotation keeps its exact submission, never resends as a new turn. */
  pendingTurn?: { id: string; conversationId: string; fingerprint: string };
}

export const annotate = createStore<AnnotateState>({
  active: false, buttonDown: false, penMode: false, tool: "pen", color: "accent", drawing: EMPTY_DRAWING, segments: [], recording: false, status: "idle",
});

export interface AnnotationSink {
  label: string;
  /** True when a Hermes turn is running and can be steered. */
  steerable(): boolean;
  send(text: string, attachments: ChatAttachment[], mode: "steer" | "queue"): void | Promise<void>;
  /** Voice sessions publish what was heard so strokes can be aligned. */
  live?: boolean;
}

const sinks: AnnotationSink[] = [];

/** The newest registration wins; the returned function unregisters it. */
export function registerSink(sink: AnnotationSink): () => void {
  sinks.push(sink);
  annotate.set(s => ({ ...s, sink: currentSink()?.label }));
  return () => {
    const i = sinks.lastIndexOf(sink);
    if (i >= 0) sinks.splice(i, 1);
    annotate.set(s => ({ ...s, sink: currentSink()?.label }));
  };
}

export function currentSink(): AnnotationSink | undefined {
  return sinks.findLast(sink => sink.live) ?? sinks.at(-1);
}

export function enterAnnotation(): void {
  annotate.set(s => (s.active ? s : { ...s, active: true, status: "idle", error: undefined, preview: undefined }));
}

/** Discard: leave the mode and throw the drawing away. */
export function exitAnnotation(): void {
  annotate.set(s => ({ ...s, active: false, drawing: EMPTY_DRAWING, segments: [], recording: false, pendingTurn: undefined, status: "idle", preview: undefined, error: undefined }));
}

/** Switch modes without discarding ink, voice or queued drafts. */
export function toggleAnnotation(): void {
  annotate.set(s => ({ ...s, ...toggleMode(s) }));
}

/** Hardware presses enter S Pen drawing; release and repeats never switch modes. */
export function stylusButton(pressed: boolean): void {
  annotate.set(s => {
    const next = penButton(s, pressed);
    return next === s ? s : { ...s, ...next, penMode: pressed ? true : s.penMode };
  });
}

export function setPenMode(on: boolean): void { annotate.set(s => ({ ...s, penMode: on })); }
export function setTool(tool: Tool): void { annotate.set(s => ({ ...s, tool })); }
export function setColor(color: InkColor): void { annotate.set(s => ({ ...s, color })); }
export function commitStroke(input: Omit<Stroke, "id" | "startedAt" | "endedAt">): void { annotate.set(s => ({ ...s, drawing: addStroke(s.drawing, input) })); }
export function eraseStrokes(path: { x: number; y: number }[]): void { annotate.set(s => ({ ...s, drawing: eraseAlong(s.drawing, path) })); }
export function undoStroke(): void { annotate.set(s => ({ ...s, drawing: undo(s.drawing) })); }
export function clearStrokes(): void { annotate.set(s => ({ ...s, drawing: clear(s.drawing) })); }
export function setRecording(recording: boolean): void { annotate.set(s => ({ ...s, recording })); }

/** Voice sessions and the tray mic both feed timed transcript segments. Old voice segments age out. */
export function addSegment(segment: Segment): void {
  const horizon = segment.end - 10 * 60_000;
  annotate.set(s => ({ ...s, segments: [...s.segments.filter(x => x.id !== segment.id && x.end >= horizon), segment] }));
}

export function setAnnotationStatus(status: AnnotateState["status"], extra: Partial<Pick<AnnotateState, "error" | "preview">> = {}): void {
  annotate.set(s => ({ ...s, status, error: extra.error, preview: extra.preview ?? (status === "idle" ? undefined : s.preview) }));
}

/** Clear only the confirmed snapshot; ink/words added during upload remain a new draft. */
export function finishSend(keep: boolean, submitted?: { strokes: readonly Stroke[]; segments: readonly Segment[] }): void {
  annotate.set(s => {
    const strokes = submitted ? s.drawing.strokes.filter(stroke => !submitted.strokes.includes(stroke)) : [];
    const segments = submitted ? s.segments.filter(segment => !submitted.segments.includes(segment)) : [];
    const remaining = strokes.length > 0 || segments.length > 0;
    return { ...s, active: keep || remaining, drawing: remaining ? { strokes, nextId: s.drawing.nextId, past: [] } : EMPTY_DRAWING,
      segments, recording: submitted ? s.recording : false, pendingTurn: undefined, status: "sent" };
  });
}
