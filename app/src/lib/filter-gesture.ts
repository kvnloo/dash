/** Shared hold/slide/dwell/scrub geometry from density-dial's filter gesture.
 * Parent integration should retain the full filter-gesture module at this path. */
export const HOLD_MS = 250;
export const DWELL_MS = 350;
export const PX_PER_LEVEL = 40;
export const FORCE_ARM = 0.5;
export function pxPerLevel(vx: number): number {
  "worklet";
  return PX_PER_LEVEL / (1 + 0.5 * Math.min(1, Math.abs(vx) / 1200));
}
export function scrubIndex(startIndex: number, dx: number, count: number, vx = 0): number {
  "worklet";
  const raw = startIndex + Math.round(dx / pxPerLevel(vx));
  return Math.max(0, Math.min(count - 1, raw));
}
