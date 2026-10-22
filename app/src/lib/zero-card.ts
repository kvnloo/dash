import type { TraceSnapshot } from "../trace/model";

/** Visible lip of a tucked card, px, at the bar's top edge. */
export const LIP = 18;
/** Release velocity (px/s) that decides the snap regardless of position. */
export const FLING = 500;

/**
 * Snap after a drag. `p` is 1 shown, 0 tucked. Velocity wins when it is a clear fling;
 * otherwise the nearer state wins. `vy` is screen-down positive.
 */
export function tuckSnap(p: number, vy: number): boolean {
  "worklet";
  if (vy > FLING) return false;
  if (vy < -FLING) return true;
  return p >= 0.5;
}

/** Progress from a drag: dragging down by the travel distance tucks fully. */
export function tuckProgress(start: number, dy: number, travel: number): number {
  "worklet";
  if (travel <= 0) return start;
  return Math.max(0, Math.min(1, start - dy / travel));
}

/** Tucked transform: slides down behind the bar and shrinks, never fades. */
export function tuckTransform(p: number, cardH: number) {
  "worklet";
  return { translateY: (1 - p) * Math.max(0, cardH - LIP), scale: 0.9 + 0.1 * p };
}

export interface TraceNow { step: string; project: string; model: string; elapsedS: number; live: number; workers: number }

/** The newest running worker is "now"; with none running, the most recent one that ended. */
export function traceNow(snapshot: TraceSnapshot): TraceNow {
  let best: { goal: string; project: string; model: string; s: number; e: number; running: boolean } | null = null;
  for (const row of snapshot.rows) {
    for (const w of row.workers) {
      const running = w.status === "running";
      const better = !best || (running && !best.running) || (running === best.running && (running ? w.s > best.s : w.e > best.e));
      if (better) best = { goal: row.goal, project: row.project, model: w.model, s: w.s, e: w.e, running };
    }
  }
  const st = snapshot.stats;
  if (!best) return { step: "No agent work reported", project: "", model: "", elapsedS: 0, live: st.live, workers: st.workers };
  return { step: best.goal, project: best.project, model: best.model, elapsedS: Math.max(0, (best.running ? snapshot.now : best.e) - best.s), live: st.live, workers: st.workers };
}
