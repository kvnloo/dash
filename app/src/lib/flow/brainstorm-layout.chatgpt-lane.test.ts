import { describe, expect, test } from "bun:test";
import { computeBrainstormLayout, type Rect } from "./brainstorm-layout";

const portrait = {
  width: 360,
  height: 800,
  safeTop: 24,
  safeBottom: 24,
  keyboardHeight: 0,
  composerHeight: 56,
};

function overlaps(a: Rect, b: Rect): boolean {
  return a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0 &&
    a.x < b.x + b.width && b.x < a.x + a.width &&
    a.y < b.y + b.height && b.y < a.y + a.height;
}

function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;
}

describe("Brainstorm layout geometry", () => {
  test("pins portrait 360 x 800: visual, transcript, bottom composer, inset pill", () => {
    expect(computeBrainstormLayout(portrait)).toEqual({
      orientation: "portrait",
      visual: { x: 0, y: 24, width: 360, height: 451 },
      transcript: { x: 0, y: 475, width: 360, height: 245 },
      composer: { x: 0, y: 720, width: 360, height: 56 },
      pill: { x: 308, y: 32, width: 44, height: 44 },
      cramped: false,
    });
  });

  test("keyboard makes visual yield before shortening the 88-DIP transcript", () => {
    const layout = computeBrainstormLayout({ ...portrait, keyboardHeight: 400 });
    expect(layout).toEqual({
      orientation: "portrait",
      visual: { x: 0, y: 24, width: 360, height: 208 },
      transcript: { x: 0, y: 232, width: 360, height: 88 },
      composer: { x: 0, y: 320, width: 360, height: 56 },
      pill: { x: 308, y: 32, width: 44, height: 44 },
      cramped: false,
    });
    expect(overlaps(layout.pill, layout.transcript)).toBe(false);
    expect(overlaps(layout.pill, layout.composer)).toBe(false);
  });

  test("when keyboard wins, keeps 30% visible and moves pill upward", () => {
    const layout = computeBrainstormLayout({ ...portrait, keyboardHeight: 600 });
    expect(layout).toEqual({
      orientation: "portrait",
      visual: { x: 0, y: 24, width: 360, height: 46 },
      transcript: { x: 0, y: 70, width: 360, height: 50 },
      composer: { x: 0, y: 120, width: 360, height: 56 },
      pill: { x: 308, y: 26, width: 44, height: 44 },
      cramped: true,
    });
    expect(overlaps(layout.pill, layout.transcript)).toBe(false);
  });

  test("at the feasible minimum, transcript can be empty but pill and composer never overlap", () => {
    const layout = computeBrainstormLayout({
      // Portrait by spec (width <= height); the keyboard leaves 100 visible DIP.
      width: 360, height: 400, safeTop: 0, safeBottom: 0,
      keyboardHeight: 300, composerHeight: 56,
    });
    expect(layout.orientation).toBe("portrait");
    expect(layout.visual).toEqual({ x: 0, y: 0, width: 360, height: 44 });
    expect(layout.transcript).toEqual({ x: 0, y: 44, width: 360, height: 0 });
    expect(layout.composer).toEqual({ x: 0, y: 44, width: 360, height: 56 });
    expect(layout.pill).toEqual({ x: 308, y: 0, width: 44, height: 44 });
    expect(layout.cramped).toBe(true);
  });

  test("landscape gives 60% to left visual and stacks right transcript above composer", () => {
    expect(computeBrainstormLayout({
      width: 800, height: 360, safeTop: 20, safeBottom: 20,
      keyboardHeight: 0, composerHeight: 56,
    })).toEqual({
      orientation: "landscape",
      visual: { x: 0, y: 20, width: 480, height: 320 },
      transcript: { x: 480, y: 20, width: 320, height: 264 },
      composer: { x: 480, y: 284, width: 320, height: 56 },
      pill: { x: 428, y: 28, width: 44, height: 44 },
      cramped: false,
    });
  });

  test("landscape keyboard shortens both columns; transcript reports cramped", () => {
    const layout = computeBrainstormLayout({
      width: 800, height: 360, safeTop: 20, safeBottom: 20,
      keyboardHeight: 240, composerHeight: 56,
    });
    expect(layout.visual).toEqual({ x: 0, y: 20, width: 480, height: 80 });
    expect(layout.transcript).toEqual({ x: 480, y: 20, width: 320, height: 24 });
    expect(layout.composer).toEqual({ x: 480, y: 44, width: 320, height: 56 });
    expect(layout.cramped).toBe(true);
    expect(contains(layout.visual, layout.pill)).toBe(true);
  });

  test("custom visual ratio, transcript minimum and pill size are honored", () => {
    const layout = computeBrainstormLayout({
      width: 360, height: 800, safeTop: 0, safeBottom: 0,
      keyboardHeight: 0, composerHeight: 60,
      visualRatio: 0.9, transcriptMinHeight: 120, pill: 48,
    });
    expect(layout.visual.height).toBe(620);
    expect(layout.transcript).toEqual({ x: 0, y: 620, width: 360, height: 120 });
    expect(layout.composer).toEqual({ x: 0, y: 740, width: 360, height: 60 });
    expect(layout.pill).toEqual({ x: 304, y: 8, width: 48, height: 48 });
    expect(layout.cramped).toBe(false);
  });

  test("fractional screen DIPs round inward and safe/IME reservations outward", () => {
    const layout = computeBrainstormLayout({
      width: 360.9, height: 800.9, safeTop: 23.2, safeBottom: 23.1,
      keyboardHeight: 400.1, composerHeight: 55.1,
    });
    expect(layout.visual).toEqual({ x: 0, y: 24, width: 360, height: 207 });
    expect(layout.transcript).toEqual({ x: 0, y: 231, width: 360, height: 88 });
    expect(layout.composer).toEqual({ x: 0, y: 319, width: 360, height: 56 });
    expect(layout.composer.y + layout.composer.height).toBeLessThanOrEqual(800.9 - 23.1 - 400.1);
  });

  test("landscape reserves a 44-DIP minimum for each column", () => {
    const layout = computeBrainstormLayout({
      width: 320, height: 250, safeTop: 0, safeBottom: 0,
      keyboardHeight: 0, composerHeight: 44, visualRatio: 0.99,
    });
    expect(layout.visual.width).toBe(276);
    expect(layout.transcript.x).toBe(276);
    expect(layout.transcript.width).toBe(44);
    expect(contains(layout.visual, layout.pill)).toBe(true);
  });

  test("rejects nonfinite, negative, unusable or sub-44-DIP geometry explicitly", () => {
    const invalid = [
      { ...portrait, width: 43 },
      { ...portrait, height: Number.NaN },
      { ...portrait, width: Infinity },
      { ...portrait, safeBottom: -1 },
      { ...portrait, keyboardHeight: Infinity },
      { ...portrait, composerHeight: -1 },
      { ...portrait, transcriptMinHeight: -1 },
      { ...portrait, visualRatio: Number.NaN },
      { ...portrait, visualRatio: 0 },
      { ...portrait, visualRatio: 1 },
      { ...portrait, pill: 43 },
      { ...portrait, keyboardHeight: 760 },
      { ...portrait, keyboardHeight: 600, composerHeight: 110 },
      {
        width: 80, height: 60, safeTop: 0, safeBottom: 0,
        keyboardHeight: 0, composerHeight: 10,
      },
    ];
    for (const input of invalid) {
      expect(() => computeBrainstormLayout(input)).toThrow(RangeError);
    }
  });

  test("1000 seeded layouts: integer, contained, disjoint panes, 44-DIP pill clearance", () => {
    let seed = 0x0ddba11;
    function random(): number {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    }
    function integer(min: number, max: number): number {
      return min + Math.floor(random() * (max - min + 1));
    }

    let landscapes = 0;
    let crampedPortraits = 0;
    for (let index = 0; index < 1000; index++) {
      const width = integer(320, 1300);
      const height = integer(360, 1400);
      const safeTop = integer(0, 48);
      const safeBottom = integer(0, 32);
      const composerHeight = integer(44, 84);
      const keyboardHeight = integer(0, Math.floor((height - safeTop - safeBottom) / 2));
      const transcriptMinHeight = integer(64, 138);
      const visualRatio = 0.25 + random() * 0.7;
      const usable = height - safeTop - safeBottom - keyboardHeight;
      const layout = computeBrainstormLayout({
        width, height, safeTop, safeBottom, keyboardHeight,
        composerHeight, transcriptMinHeight, visualRatio,
      });

      expect(layout.orientation).toBe(width > height ? "landscape" : "portrait");
      for (const rect of [layout.visual, layout.transcript, layout.composer, layout.pill]) {
        for (const n of [rect.x, rect.y, rect.width, rect.height]) {
          expect(Number.isInteger(n)).toBe(true);
        }
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(safeTop);
        expect(rect.width).toBeGreaterThanOrEqual(0);
        expect(rect.height).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(width);
        expect(rect.y + rect.height).toBeLessThanOrEqual(height - safeBottom - keyboardHeight);
      }

      expect(layout.pill.width).toBe(44);
      expect(layout.pill.height).toBe(44);
      expect(contains(layout.visual, layout.pill)).toBe(true);
      expect(overlaps(layout.pill, layout.transcript)).toBe(false);
      expect(overlaps(layout.pill, layout.composer)).toBe(false);
      expect(overlaps(layout.visual, layout.transcript)).toBe(false);
      expect(overlaps(layout.visual, layout.composer)).toBe(false);
      expect(overlaps(layout.transcript, layout.composer)).toBe(false);

      if (layout.orientation === "landscape") {
        landscapes++;
        expect(layout.visual.height).toBe(usable);
        expect(layout.transcript.x).toBe(layout.visual.width);
        expect(layout.composer.x).toBe(layout.visual.width);
        expect(layout.transcript.width).toBe(width - layout.visual.width);
        expect(layout.composer.width).toBe(width - layout.visual.width);
        expect(layout.transcript.height + layout.composer.height).toBe(usable);
      } else {
        expect(layout.visual.width).toBe(width);
        expect(layout.transcript.width).toBe(width);
        expect(layout.composer.width).toBe(width);
        expect(layout.visual.height + layout.transcript.height + layout.composer.height).toBe(usable);
        expect(layout.composer.y + layout.composer.height).toBe(safeTop + usable);
        if (layout.cramped) {
          crampedPortraits++;
          expect(layout.visual.height).toBeGreaterThanOrEqual(Math.ceil(usable * 0.3));
          expect(layout.transcript.height).toBeLessThan(transcriptMinHeight);
        } else {
          expect(layout.transcript.height).toBeGreaterThanOrEqual(transcriptMinHeight);
          expect(layout.visual.height).toBe(Math.max(
            44, Math.min(Math.round(usable * visualRatio), usable - composerHeight - transcriptMinHeight),
          ));
        }
      }
    }
    expect(landscapes).toBeGreaterThan(0);
    expect(crampedPortraits).toBeGreaterThan(0);
  });
});
