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
