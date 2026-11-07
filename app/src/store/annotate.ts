// Annotation mode state. One overlay for the whole app; screens register where a
// finished annotation goes (the open chat, or the live voice session).
import { Platform } from "react-native";
import type { ChatAttachment } from "../../../shared/protocol";
import type { Segment } from "../lib/annotate/align";
import { EMPTY_DRAWING, addStroke, clear, eraseAlong, undo, type Drawing, type InkColor, type Stroke, type Tool } from "../lib/annotate/strokes";
import { penButton } from "../lib/stylus-mode";
import { createStore } from "./createStore";

export interface AnnotationPreview {
  /** data: URI of the composited PNG, shown before upload finishes. */
  image: string;
  text: string;
  strokes: number;
}

export type AnnotateEngine = "skia" | "tldraw";
function defaultEngine(): AnnotateEngine {
  const flag = Platform.OS === "web" && typeof location !== "undefined" ? new URLSearchParams(location.search).get("annotateEngine") : process.env.EXPO_PUBLIC_ANNOTATE_ENGINE;
  return flag === "skia" || flag === "tldraw" ? flag : Platform.OS === "web" ? "tldraw" : "skia";
}

export interface AnnotateState {
  annotateEngine: AnnotateEngine;
  active: boolean;
  /** Current S Pen side-button latch, to ignore repeats until release. */
  buttonDown: boolean;
  /** Palm rejection: only the S Pen draws; fingers scroll. Persisted per app run. */
  penMode: boolean;
  tool: Tool;
  color: InkColor;
  drawing: Drawing;
  segments: Segment[];
  /** The typed annotation intent, also included in the sent transcript. */
  typed: string;
  /** Hold-to-talk mic in the tray is recording. */
  recording: boolean;
  status: "idle" | "capturing" | "sending" | "sent" | "error";
  error?: string;
  /** Quiet reason an annotation-triggered live voice call could not start. */
  voiceNote?: string;
  preview?: AnnotationPreview;
  /** Which sink a Send will reach, for the tray label. */
  sink?: string;
  /** An unconfirmed voice annotation keeps its exact submission, never resends as a new turn. */
  pendingTurn?: { id: string; conversationId: string; fingerprint: string };
}

/** Annotation is a volatile session: cold starts and module refreshes begin closed.
 * Never seed active or penMode from stored settings or a prior module instance. */
function initialAnnotationState(): AnnotateState {
  return {
    annotateEngine: defaultEngine(),
    active: false, buttonDown: false, penMode: false, tool: "pen", color: "accent",
    drawing: EMPTY_DRAWING, segments: [], typed: "", recording: false, status: "idle", voiceNote: undefined,
  };
}

export const annotate = createStore<AnnotateState>(initialAnnotationState());

export interface AnnotationSink {
  label: string;
  /** Conversation owning this sink; used to prevent cross-chat annotation routing. */
  conversationId?: string;
  /** True when a Hermes turn is running and can be steered. */
  steerable(): boolean;
  send(text: string, attachments: ChatAttachment[], mode: "steer" | "queue"): void | Promise<void>;
  /** Voice sessions publish what was heard so strokes can be aligned. */
  live?: boolean;
}

const sinks: AnnotationSink[] = [];

/** Physical stylus detection is volatile: a reload forgets it along with the overlay. */
let stylusObserved = false;
export function observeStylusPointer(): void { stylusObserved = true; }

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
  const chat = sinks.findLast(sink => !sink.live);
  const voice = sinks.findLast(sink => sink.live);
  // A voice call can stay bound to Hermes while a different harness chat is open.
  // Never let that call steal ink from the open chat.
  if (chat) return voice?.conversationId === chat.conversationId && !!chat.conversationId ? voice : chat;
  return voice;
}

/** All entry points reset transient feedback; palm rejection needs observed hardware. */
export function enterAnnotation(): void {
  annotate.set(s => (s.active ? s : {
    ...s, active: true, penMode: stylusObserved,
    status: "idle", error: undefined, voiceNote: undefined, preview: undefined,
  }));
}

/** Exit closes the overlay, not the draft. Clear is the explicit ink discard. */
export function exitAnnotation(): void {
  annotate.set(s => ({ ...s, active: false, recording: false, status: "idle", preview: undefined, error: undefined, voiceNote: undefined }));
}

/** The nav pill and hardware button use exactly the same lifecycle as chat entry. */
export function toggleAnnotation(): void {
  if (annotate.get().active) exitAnnotation();
  else enterAnnotation();
}

/** The native S Pen side-button counts as detection; only its rising edge toggles. */
export function stylusButton(pressed: boolean): void {
  if (pressed) stylusObserved = true;
  const current = annotate.get();
  const next = penButton(current, pressed);
  if (next === current) return;
  annotate.set(s => ({ ...s, buttonDown: next.buttonDown }));
  if (pressed) toggleAnnotation();
}

export function setPenMode(on: boolean): void { annotate.set(s => ({ ...s, penMode: on })); }
export function setTool(tool: Tool): void { annotate.set(s => ({ ...s, tool })); }
export function setColor(color: InkColor): void { annotate.set(s => ({ ...s, color })); }
export function commitStroke(input: Omit<Stroke, "id" | "startedAt" | "endedAt">): void { annotate.set(s => ({ ...s, drawing: addStroke(s.drawing, input) })); }
/** DOM commits use the same addStroke path as Skia; edits retain stable marker IDs. */
export function syncTldrawStrokes(strokes: Stroke[]): void {
  if (!annotate.get().active) return;
  const previous = annotate.get().drawing.strokes;
  // finishSend excludes its immutable snapshot by reference. A DOM document
  // notification must not replace unchanged marks while another is uploaded.
  const stable = strokes.map(stroke => {
    const saved = previous.find(saved => saved.id === stroke.id);
    return saved && JSON.stringify(saved) === JSON.stringify(stroke) ? saved : stroke;
  });
  for (const stroke of stable) {
    if (!previous.some(saved => saved.id === stroke.id)) commitStroke(stroke);
  }
  annotate.set(s => ({ ...s, drawing: { ...s.drawing, strokes: stable, nextId: Math.max(s.drawing.nextId, ...stable.map(stroke => stroke.id + 1)) } }));
}

export function eraseStrokes(path: { x: number; y: number }[]): void { annotate.set(s => ({ ...s, drawing: eraseAlong(s.drawing, path) })); }
export function undoStroke(): void { annotate.set(s => ({ ...s, drawing: undo(s.drawing) })); }
export function clearStrokes(): void { annotate.set(s => ({ ...s, drawing: clear(s.drawing) })); }
export function setRecording(recording: boolean): void { annotate.set(s => ({ ...s, recording })); }
export function setTypedNote(typed: string): void { annotate.set(s => ({ ...s, typed: typed.slice(0, 2000) })); }

/** Voice sessions and the tray mic both feed timed transcript segments. Old voice segments age out. */
export function addSegment(segment: Segment): void {
  const horizon = segment.end - 10 * 60_000;
  annotate.set(s => ({ ...s, segments: [...s.segments.filter(x => x.id !== segment.id && x.end >= horizon), segment] }));
}

export function setAnnotationStatus(status: AnnotateState["status"], extra: Partial<Pick<AnnotateState, "error" | "preview">> = {}): void {
  annotate.set(s => ({ ...s, status, error: extra.error, preview: extra.preview ?? (status === "idle" ? undefined : s.preview) }));
}

/** Clear only the confirmed snapshot; ink/words added during upload remain a new draft. */
export function finishSend(keep: boolean, submitted?: { strokes: readonly Stroke[]; segments: readonly Segment[]; typed: string }): void {
  annotate.set(s => {
    const strokes = submitted ? s.drawing.strokes.filter(stroke => !submitted.strokes.includes(stroke)) : [];
    const segments = submitted ? s.segments.filter(segment => !submitted.segments.includes(segment)) : [];
    // Do not discard a note edited while an earlier snapshot was uploading.
    const typed = submitted && s.typed !== submitted.typed ? s.typed : "";
    const remaining = strokes.length > 0 || segments.length > 0 || typed.trim().length > 0;
    return { ...s, active: keep || remaining, drawing: remaining ? { strokes, nextId: s.drawing.nextId, past: [] } : EMPTY_DRAWING,
      segments, typed, recording: submitted ? s.recording : false, pendingTurn: undefined, status: "sent" };
  });
}
