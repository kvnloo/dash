/**
 * Keep React Native's performance timeline from growing without bound.
 *
 * React's development renderer (the dev client Dash runs from Metro) records a
 * `performance.measure` for every component render once `console.timeStamp` and
 * `performance.measure` exist. React Native's native PerformanceEntryReporter keeps
 * every measure until `performance.clearMeasures()` is called, and nothing reads
 * them. A streaming chat re-renders on every frame, so native memory grew by
 * roughly 60 MB per minute from this buffer alone (docs/memory-retention.md).
 * Production React records no measures; trimming is harmless there.
 * Marks are left alone: Dash's own marks are few and read by the voice journeys.
 */
export type MeasureTimeline = { clearMeasures?: (name?: string) => void };

export function installPerformanceBufferTrim(
  timeline: MeasureTimeline | undefined,
  every = 2000,
  schedule: (run: () => void, ms: number) => unknown = setInterval,
): boolean {
  const clear = timeline?.clearMeasures;
  if (typeof clear !== "function") return false;
  schedule(() => { try { clear.call(timeline); } catch { /* a missing native module must not break the app */ } }, every);
  return true;
}
