// One switch for Dash's ephemeral-ui modes (Kevin 10-26: "i like the normal/annotate surfaces,
// let's also add the "learn" surface there"; 11-19: "quick action mode (for unblocking work)").
// Annotate keeps its own store (ink, tray, S Pen button); Learn and Quick are surfaces owned here.

import { createStore } from "./createStore";
import { annotate, enterAnnotation, exitAnnotation } from "./annotate";
import { nextPillMode, pillModeOf, type PillMode } from "../lib/ephemeral-modes";

export { nextPillMode, pillModeOf, PILL_LABEL, type PillMode } from "../lib/ephemeral-modes";
export type SurfaceMode = "learn" | "quick" | null;

export const surfaceMode = createStore<SurfaceMode>(null);
/** The Learn topic outlives the panel, so a sketch or a closed panel does not lose it. */
export const learnTopic = createStore("");
/** Learn's Talk: while listening, each final z0live transcript becomes a Learn topic. */
export interface LearnVoiceState {
  listening: boolean;
  /** Learn started the live call, so leaving Learn ends it. */
  ownsCall?: boolean;
  heard?: { id: string; text: string };
}
export const learnVoice = createStore<LearnVoiceState>({ listening: false });

/** Called by the live voice call for every final user transcript. */
export function hearLearnTopic(id: string, text: string): void {
  if (!learnVoice.get().listening || surfaceMode.get() !== "learn" || !text.trim()) return;
  learnVoice.set(s => ({ ...s, heard: { id, text: text.trim().slice(0, 300) } }));
}

// Annotate can also start from the S Pen side button or the chat's ✎ Annotate. It always
// replaces Learn/Quick, so Exit/Back from Annotate lands on Normal whichever way it began,
// except a Learn sketch (Learn's Draw), which goes back to Learn.
let wasAnnotating = annotate.get().active;
annotate.subscribe(() => {
  const { active, learn } = annotate.get();
  if (active && surfaceMode.get() !== null) surfaceMode.set(null);
  if (wasAnnotating && !active && learn) {
    annotate.set(s => ({ ...s, learn: undefined }));
    surfaceMode.set("learn");
  }
  wasAnnotating = active;
});

export function cyclePillMode(): void {
  setPillMode(nextPillMode(pillModeOf(annotate.get().active, surfaceMode.get())));
}

export function setPillMode(mode: PillMode): void {
  if (mode === "annotate") {
    surfaceMode.set(null);
    enterAnnotation();
    return;
  }
  if (annotate.get().active) {
    // An explicit mode choice wins over a Learn sketch's way back.
    annotate.set(s => (s.learn ? { ...s, learn: undefined } : s));
    exitAnnotation();
  }
  surfaceMode.set(mode === "normal" ? null : mode);
}
