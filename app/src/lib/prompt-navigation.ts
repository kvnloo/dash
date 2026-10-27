export interface PromptAnchor { id: string; index: number; text: string }
export function promptAnchors(messages: readonly { id: string; role: string; text: string }[]): PromptAnchor[] {
  return messages.flatMap((m, index) => m.role === "user" ? [{ id: m.id, index, text: m.text || "Attached files" }] : []);
}
/** Use FlashList's measured layout; unknown rows must use scrollToIndex instead. */
export function promptOffset(anchors: readonly PromptAnchor[], prompt: number, layout: (index: number) => { y: number; isHeightMeasured?: boolean } | undefined): number | null {
  const anchor = anchors[prompt];
  if (!anchor) return null;
  // A measured destination can still have an estimated Y if preceding rows
  // have not been measured. Let scrollToIndex resolve those virtualized rows.
  for (let index = 0; index <= anchor.index; index++) {
    if (!layout(index)?.isHeightMeasured) return null;
  }
  return layout(anchor.index)?.y ?? null;
}
/** Prompt ticks occupy the rail above the separate 44px Latest target. */
export function railTarget(y: number, tickHeight: number, count: number): number {
  "worklet";
  if (count === 0 || tickHeight <= 0 || y >= tickHeight) return count;
  return Math.min(count - 1, Math.max(0, Math.floor(y / tickHeight * count)));
}
export function followsLatest(contentHeight: number, viewportHeight: number, offset: number): boolean {
  return contentHeight - viewportHeight - offset <= 48;
}

/** Tick centres sit at the start of their owned run segment, inset by half a marker gap.
 * The distance AFTER a tick encodes its duration, not the duration before it. */
export function railLayout(durations: readonly number[], height: number, minGap = 6): number[] {
  if (!durations.length) return [];
  const available = Number.isFinite(height) ? Math.max(0, height) : 0;
  const gap = Number.isFinite(minGap) ? Math.max(0, minGap) : 6;
  const count = durations.length;
  if (count * gap > available) return durations.map((_, index) => (index + .5) * available / count);
  const weights = durations.map(duration => Number.isFinite(duration) ? Math.max(0, duration) : 0);
  const total = weights.reduce((sum, duration) => sum + duration, 0);
  const spare = available - count * gap;
  let offset = 0;
  return weights.map(duration => {
    const center = offset + gap / 2;
    offset += gap + (total > 0 ? spare * duration / total : spare / count);
    return center;
  });
}
/** Nearest tick with midpoint boundaries; the rail bottom is the separate Latest target. */
export function railTargetAt(y: number, positions: readonly number[], height: number): number {
  "worklet";
  if (!positions.length || height <= 0 || y >= height) return positions.length;
  for (let index = 1; index < positions.length; index++) {
    if (y < ((positions[index - 1] ?? 0) + (positions[index] ?? 0)) / 2) return index - 1;
  }
  return positions.length - 1;
}
