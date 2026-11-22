// One switch for Dash's ephemeral-ui modes (Kevin 10-26: "i like the normal/annotate surfaces,
// let's also add the "learn" surface there"; 11-19: "quick action mode (for unblocking work)").
// Annotate keeps its own store (ink, tray, S Pen button); Learn and Quick are surfaces owned here.

import { createStore } from "./createStore";
import { annotate, enterAnnotation, exitAnnotation } from "./annotate";
import { nextPillMode, pillModeOf, type PillMode } from "../lib/ephemeral-modes";

export { nextPillMode, pillModeOf, PILL_LABEL, type PillMode } from "../lib/ephemeral-modes";
export type SurfaceMode = "learn" | "quick" | null;

export const surfaceMode = createStore<SurfaceMode>(null);

// Annotate can also start from the S Pen side button or the chat's ✎ Annotate. It always
// replaces Learn/Quick, so Exit/Back from Annotate lands on Normal whichever way it began.
annotate.subscribe(() => {
  if (annotate.get().active && surfaceMode.get() !== null) surfaceMode.set(null);
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
  if (annotate.get().active) exitAnnotation();
  surfaceMode.set(mode === "normal" ? null : mode);
}
