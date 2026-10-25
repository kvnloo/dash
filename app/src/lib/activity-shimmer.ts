import type { ConnectionStatus } from "../model";
import type { ThinkingPhase } from "./thinking";

/** Only work actually in progress shimmers. A pending handoff or approval is not active work. */
export function activityShimmerEnabled(phase: ThinkingPhase, connection: ConnectionStatus, stale: boolean): boolean {
  return !stale && connection === "online" &&
    (phase === "thinking" || phase === "tool" || phase === "streaming");
}

/** Travel fully across the glyphs; the pause holds a dim, off-glyph band. */
export const SHIMMER_START = -0.28;
export const SHIMMER_END = 1.28;
export const SHIMMER_BAND = 0.18;
export const SHIMMER_SWEEP_MS = 1500;
export const SHIMMER_REST_MS = 250;

/** Five ordered positions for dim -> dim -> bright -> dim -> dim text paint. */
export function shimmerStops(progress: number): [number, number, number, number, number] {
  "worklet";
  const center = Number.isFinite(progress) ? Math.min(SHIMMER_END, Math.max(SHIMMER_START, progress)) : SHIMMER_START;
  const left = Math.min(1, Math.max(0, center - SHIMMER_BAND));
  const middle = Math.min(1, Math.max(0, center));
  const right = Math.min(1, Math.max(0, center + SHIMMER_BAND));
  return [0, left, middle, right, 1];
}
