import { describe, expect, test } from "bun:test";
import { ALIGN_SLACK_MS, annotateTranscript, marker, segmentFor, wordSlot, type Segment } from "./align";
import type { Stroke } from "./strokes";

const seg = (id: string, text: string, start: number, end: number): Segment => ({ id, text, start, end, source: "voice" });
const stroke = (id: number, startedAt: number, endedAt = startedAt + 100): Stroke => ({ id, tool: "pen", color: "accent", pointer: "stylus", points: [], startedAt, endedAt });

describe("segmentFor", () => {
  const segments = [seg("a", "one", 1000, 2000), seg("b", "two", 5000, 6000)];
  test("the segment a stroke started in, inclusive", () => {
    expect(segmentFor(stroke(1, 1000), segments)?.id).toBe("a");
    expect(segmentFor(stroke(1, 2000), segments)?.id).toBe("a");
    expect(segmentFor(stroke(1, 5500), segments)?.id).toBe("b");
  });
  test("else the nearest within slack", () => {
    expect(segmentFor(stroke(1, 2500, 2600), segments)?.id).toBe("a");
    expect(segmentFor(stroke(1, 4000, 4800), segments)?.id).toBe("b");
    expect(segmentFor(stroke(1, 2000 + ALIGN_SLACK_MS, 9000 + ALIGN_SLACK_MS), [segments[0] ?? seg("x", "", 0, 0)])?.id).toBe("a");
    expect(segmentFor(stroke(1, 2001 + ALIGN_SLACK_MS), [segments[0] ?? seg("x", "", 0, 0)])).toBeUndefined();
    expect(segmentFor(stroke(1, 500, 700), segments)?.id).toBe("a");
    expect(segmentFor(stroke(1, 0), [])).toBeUndefined();
  });
});

describe("wordSlot", () => {
  const s = seg("a", "", 0, 1000);
  test("linear in time, at least after the first word", () => {
    expect(wordSlot(s, 4, 0)).toBe(1);
    expect(wordSlot(s, 4, 500)).toBe(2);
    expect(wordSlot(s, 4, 510)).toBe(3);
    expect(wordSlot(s, 4, 1000)).toBe(4);
    expect(wordSlot(s, 4, 5000)).toBe(4);
    expect(wordSlot(s, 4, -50)).toBe(1);
    expect(wordSlot(s, 0, 500)).toBe(0);
    expect(wordSlot(seg("z", "", 10, 10), 3, 10)).toBe(3);
  });
});

describe("annotateTranscript", () => {
  test("puts each marker after the word being spoken", () => {
    const segments = [seg("a", "make this taller", 0, 900), seg("b", "and move this down", 2000, 2800)];
    const out = annotateTranscript([stroke(2, 500), stroke(3, 2500)], segments);
    expect(out.text).toBe(`make this ${marker(2)} taller and move this ${marker(3)} down`);
    expect(out.unspoken).toEqual([]);
  });
  test("orders segments by time, skips blank ones and reports unspoken strokes", () => {
    const out = annotateTranscript([stroke(1, 50_000), stroke(4, 100)], [seg("b", "second", 1000, 1200), seg("a", "first", 0, 200), seg("c", "  ", 300, 400)]);
    expect(out.text).toBe(`first ${marker(4)} second`);
    expect(out.unspoken).toEqual([1]);
  });
  test("several strokes on one word keep drawing order", () => {
    expect(annotateTranscript([stroke(1, 10), stroke(2, 20)], [seg("a", "here", 0, 100)]).text).toBe(`here ${marker(1)} ${marker(2)}`);
  });
  test("slack is three seconds", () => {
    expect(ALIGN_SLACK_MS).toBe(3000);
  });
  test("marker format", () => {
    expect(marker(7)).toBe("⟦stroke 7⟧");
  });
});
