import { describe, expect, test } from "bun:test";
import { INFO_CONTRACTS, firstLevel, partsAt, readText, shows, topN, type InfoComponent } from "./info-levels";

const LEVELS = [1, 2, 3, 4, 5] as const;
const COMPONENTS = Object.keys(INFO_CONTRACTS) as InfoComponent[];

describe("per-component level contracts", () => {
  test("exact parts per level (the DENSITY.md table)", () => {
    expect(LEVELS.map(l => partsAt("stat", l))).toEqual([["value"], ["value", "delta"], ["value", "delta", "chart"], ["value", "delta", "chart", "range"], ["value", "delta", "chart", "range", "breakdown"]]);
    expect(LEVELS.map(l => partsAt("timeline", l))).toEqual([["rows"], ["rows", "goal"], ["rows", "goal", "bars"], ["rows", "goal", "bars", "axis", "counts"], ["rows", "goal", "bars", "axis", "counts", "outliers", "annotations"]]);
    expect(LEVELS.map(l => partsAt("readStrip", l).length)).toEqual([1, 2, 3, 4, 4]);
    expect(LEVELS.map(l => partsAt("actionChip", l))).toEqual([["title"], ["title", "outcome"], ["title", "outcome", "why"], ["title", "outcome", "why", "hint"], ["title", "outcome", "why", "hint", "buttons"]]);
    expect(LEVELS.map(l => partsAt("orchestraNode", l))).toEqual([["glyph"], ["glyph", "label"], ["glyph", "label", "state"], ["glyph", "label", "state", "caption"], ["glyph", "label", "state", "caption", "path"]]);
    expect(LEVELS.map(l => partsAt("toolRow", l).length)).toEqual([1, 2, 3, 4, 5]);
    expect(partsAt("zeroCard", 1)).toEqual(["name", "phase", "trace"]);
    expect(partsAt("zeroCard", 2)).toEqual(["name", "phase", "trace", "step", "elapsed"]);
    expect(partsAt("zeroCard", 4)).toEqual(["name", "phase", "trace", "step", "elapsed", "counts", "path", "workers"]);
    expect(partsAt("traceCard", 1)).toEqual(["phase", "step"]);
    expect(partsAt("traceCard", 5)).toEqual(["phase", "step", "elapsed", "counts", "workers", "read"]);
  });
  test("levels are cumulative, L5 hides nothing, L1 shows exactly one first-level fact group", () => {
    for (const c of COMPONENTS) {
      for (let i = 1; i < LEVELS.length; i += 1) {
        const lo = partsAt(c, LEVELS[i - 1] ?? 1), hi = partsAt(c, LEVELS[i] ?? 5);
        for (const part of lo) expect(hi).toContain(part);
      }
      expect(partsAt(c, 5)).toEqual([...INFO_CONTRACTS[c]]);
      expect(partsAt(c, 1).length).toBeGreaterThan(0);
      expect(partsAt(c, 1).length).toBeLessThan(INFO_CONTRACTS[c].length);
    }
  });
  test("shows and firstLevel agree at the boundary", () => {
    expect(firstLevel("stat", "chart")).toBe(3);
    expect(shows("stat", "chart", 2)).toBe(false);
    expect(shows("stat", "chart", 3)).toBe(true);
    expect(shows("timeline", "outliers", 4)).toBe(false);
    expect(shows("timeline", "outliers", 5)).toBe(true);
  });
});

describe("text and list helpers", () => {
  test("ReadStrip L1 is the first sentence, L2+ the whole read", () => {
    const text = "Two workers live. One cut at 14:20. Asks pending.";
    expect(readText(text, 1)).toBe("Two workers live.");
    expect(readText(text, 2)).toBe(text);
    expect(readText("No period", 1)).toBe("No period");
  });
  test("top segments: none at L1, top 3 at L2, all from L3", () => {
    const items = [1, 2, 3, 4, 5];
    expect(topN(items, 1)).toEqual([]);
    expect(topN(items, 2)).toEqual([1, 2, 3]);
    expect(topN(items, 2, 2)).toEqual([1, 2]);
    expect(topN(items, 3)).toEqual(items);
  });
});
