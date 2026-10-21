import { describe, expect, test } from "bun:test";
import { ANNOTATION_SCHEMA, annotationDoc, annotationSendMode, attachmentNames, composeMessage, strokeLegend } from "./compose";
import type { Segment } from "./align";
import type { Stroke } from "./strokes";

const screen = { id: "Chat-abc", route: "Chat", width: 412, height: 915 };
const arrow: Stroke = { id: 1, tool: "arrow", color: "accent", pointer: "stylus", startedAt: 1000, endedAt: 1300, targets: ["composer"],
  points: [{ x: 0.123456, y: 0.2, p: 0.333, t: 1000 }, { x: 0.3, y: 0.4, p: 0.5, t: 1300 }] };
const box: Stroke = { id: 2, tool: "box", color: "red", pointer: "touch", startedAt: 9000, endedAt: 9400,
  points: [{ x: 0.5, y: 0.5, p: 0.5, t: 9000 }, { x: 0.7, y: 0.9, p: 0.5, t: 9400 }] };
const segments: Segment[] = [{ id: "s1", text: "make this taller", start: 900, end: 1500, source: "mic" }];

describe("annotationDoc", () => {
  test("normalized, rounded points with relative times and segment ids", () => {
    const doc = annotationDoc({ strokes: [arrow, box], segments, screen, createdAt: 42 });
    expect(doc.schema).toBe(ANNOTATION_SCHEMA);
    expect(doc.schema).toBe("dash.annotation.v1");
    expect(doc.createdAt).toBe(42);
    expect(doc.screen).toEqual(screen);
    expect(doc.strokes[0]?.points).toEqual([[0.1235, 0.2, 0.33, 0], [0.3, 0.4, 0.5, 300]]);
    expect(doc.strokes[0]?.segment).toBe("s1");
    expect(doc.strokes[0]?.targets).toEqual(["composer"]);
    expect(doc.strokes[1]?.targets).toEqual([]);
    expect("segment" in (doc.strokes[1] ?? {})).toBe(false);
    expect(doc.strokes[1]).toMatchObject({ id: 2, tool: "box", color: "red", pointer: "touch", startedAt: 9000, endedAt: 9400 });
    expect(doc.transcript.text).toBe("make ⟦stroke 1⟧ this taller");
    expect(doc.transcript.segments).toEqual(segments);
  });
});

describe("composeMessage", () => {
  test("header, spoken text with markers, unspoken list and legend", () => {
    const text = composeMessage({ strokes: [arrow, box], segments, screen });
    expect(text).toBe([
      "Annotated Chat (2 strokes). Screenshot with the marks and the strokes JSON are attached.",
      "make ⟦stroke 1⟧ this taller\nAlso marked without speaking: ⟦stroke 2⟧",
      "⟦stroke 1⟧ arrow at 21%,30% on composer\n⟦stroke 2⟧ box (red) at 60%,70%",
    ].join("\n\n"));
  });
  test("typed text comes first; one stroke is singular; no speech means no body", () => {
    expect(composeMessage({ strokes: [arrow], segments: [], screen, typed: "  look  " })).toBe(
      "Annotated Chat (1 stroke). Screenshot with the marks and the strokes JSON are attached.\n\nlook\nAlso marked without speaking: ⟦stroke 1⟧\n\n⟦stroke 1⟧ arrow at 21%,30% on composer");
    expect(composeMessage({ strokes: [], segments: [], screen })).toBe("Annotated Chat (0 strokes). Screenshot with the marks and the strokes JSON are attached.");
  });
  test("legend line per stroke", () => {
    expect(strokeLegend([box])).toBe("⟦stroke 2⟧ box (red) at 60%,70%");
    expect(strokeLegend([])).toBe("");
  });
});

test("attachment names are filesystem-safe and paired", () => {
  expect(attachmentNames(Date.UTC(2026, 9, 21, 12, 30, 5, 7))).toEqual({ image: "annotation-2026-10-21T12-30-05-007Z.png", json: "annotation-2026-10-21T12-30-05-007Z.json" });
});

test("steer only when the running turn can take it", () => {
  expect(annotationSendMode(true)).toBe("steer");
  expect(annotationSendMode(false)).toBe("queue");
});
