// Align strokes with what Kevin said while drawing them, so "this one" maps to the
// stroke drawn during those words.
import type { Stroke } from "./strokes";

export interface Segment {
  id: string;
  text: string;
  start: number;
  end: number;
  source: "voice" | "mic";
}

/** A stroke this far (ms) outside every segment still belongs to the nearest one. */
export const ALIGN_SLACK_MS = 3000;

export function marker(id: number): string {
  return `⟦stroke ${id}⟧`;
}

/** The segment a stroke belongs to: the one it started in, else the nearest within slack. */
export function segmentFor(stroke: Pick<Stroke, "startedAt" | "endedAt">, segments: readonly Segment[]): Segment | undefined {
  const inside = segments.find(s => stroke.startedAt >= s.start && stroke.startedAt <= s.end);
  if (inside) return inside;
  let best: Segment | undefined;
  let bestGap = Infinity;
  for (const s of segments) {
    const gap = Math.max(s.start - stroke.endedAt, stroke.startedAt - s.end, 0);
    if (gap <= ALIGN_SLACK_MS && gap < bestGap) { best = s; bestGap = gap; }
  }
  return best;
}

/** Word index after which a stroke started, by linear time within the segment. */
export function wordSlot(segment: Segment, words: number, at: number): number {
  if (words === 0) return 0;
  const span = segment.end - segment.start;
  const k = span <= 0 ? 1 : (at - segment.start) / span;
  return Math.max(1, Math.min(words, Math.ceil(Math.max(0, Math.min(1, k)) * words)));
}

/**
 * The transcript with a marker after the word being spoken when each stroke began,
 * e.g. "make this ⟦stroke 2⟧ taller". Strokes no segment claims are listed last.
 */
export function annotateTranscript(strokes: readonly Stroke[], segments: readonly Segment[]): { text: string; unspoken: number[] } {
  const ordered = [...segments].filter(s => s.text.trim()).sort((a, b) => a.start - b.start);
  const bySegment = new Map<string, Stroke[]>();
  const unspoken: number[] = [];
  for (const stroke of strokes) {
    const segment = segmentFor(stroke, ordered);
    if (!segment) { unspoken.push(stroke.id); continue; }
    bySegment.set(segment.id, [...(bySegment.get(segment.id) ?? []), stroke]);
  }
  const parts = ordered.map(segment => {
    const words = segment.text.trim().split(/\s+/);
    const after = new Map<number, number[]>();
    for (const stroke of bySegment.get(segment.id) ?? []) {
      const slot = wordSlot(segment, words.length, stroke.startedAt);
      after.set(slot, [...(after.get(slot) ?? []), stroke.id]);
    }
    return words.flatMap((word, i) => [word, ...(after.get(i + 1) ?? []).map(marker)]).join(" ");
  });
  return { text: parts.join(" "), unspoken };
}
