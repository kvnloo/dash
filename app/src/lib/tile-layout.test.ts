import { describe, expect, test } from "bun:test";
import { componentSizing, DENSITIES, radialCenter, radialPosition, radialSector, tileColumns } from "./tile-layout";

describe("component sizing contract", () => {
  test("density grows intrinsic minima; never fixes an aspect ratio", () => {
    const compact = componentSizing("compact"), comfortable = componentSizing("comfortable"), rich = componentSizing("rich");
    expect([compact.rowMin, comfortable.rowMin, rich.rowMin]).toEqual([44, 60, 84]);
    expect([compact.tileMin, comfortable.tileMin, rich.tileMin]).toEqual([100, 136, 176]);
    expect([compact.padding, comfortable.padding, rich.padding]).toEqual([8, 12, 18]);
    expect([compact.plotMin, comfortable.plotMin, rich.plotMin]).toEqual([44, 68, 100]);
    expect([compact.gap, comfortable.gap, rich.gap]).toEqual([4, 8, 12]);
  });
  test("large font scales minima, and small fonts never shrink touch targets", () => {
    for (const density of DENSITIES) {
      expect(componentSizing(density, 2).rowMin).toBe(componentSizing(density).rowMin * 2);
      expect(componentSizing(density, 2).tileMin).toBe(componentSizing(density).tileMin * 2);
      expect(componentSizing(density, 0.5)).toEqual(componentSizing(density));
    }
  });
});

test("stat grids reflow all requested widths before large type becomes character columns", () => {
  const widths = [360, 412, 480];
  expect(widths.map(width => tileColumns(width - 16, "compact", 1, 6))).toEqual([3, 3, 3]);
  expect(widths.map(width => tileColumns(width - 16, "comfortable", 1, 6))).toEqual([2, 3, 3]);
  expect(widths.map(width => tileColumns(width - 16, "rich", 1, 6))).toEqual([2, 3, 3]);
  expect(widths.map(width => tileColumns(width - 16, "compact", 1.6, 6))).toEqual([2, 2, 2]);
  expect(widths.map(width => tileColumns(width - 16, "comfortable", 1.6, 6))).toEqual([1, 2, 2]);
  expect(widths.map(width => tileColumns(width - 16, "rich", 1.6, 6))).toEqual([1, 1, 2]);
  expect(tileColumns(0, "rich", 2)).toBe(1);
  expect(tileColumns(2000, "compact")).toBe(3);
});

describe("radial wheel geometry", () => {
  test("centre and invalid action counts cancel", () => {
    expect(radialSector(0, 0, 4, false)).toBe(-1);
    expect(radialSector(29, 0, 4, false)).toBe(-1);
    expect(radialSector(100, 0, 3, false)).toBe(-1);
    expect(radialSector(100, 0, 9, false)).toBe(-1);
  });
  test("cardinals match readable labels and mirror direction, never text", () => {
    expect(radialSector(0, -80, 4, false)).toBe(0);
    expect(radialSector(80, 0, 4, false)).toBe(1);
    expect(radialSector(0, 80, 4, false)).toBe(2);
    expect(radialSector(-80, 0, 4, false)).toBe(3);
    expect(radialSector(-80, 0, 4, true)).toBe(1);
    expect(radialSector(80, 0, 4, true)).toBe(3);
  });
  test("all 4–8 action centres round-trip on both hands", () => {
    for (const count of [4, 5, 6, 7, 8]) for (const left of [false, true]) for (let i = 0; i < count; i++) {
      const p = radialPosition(i, count, left, 106);
      expect(radialSector(p.x, p.y, count, left)).toBe(i);
    }
  });
  test("wheel clamps away from all edges at every requested screen width", () => {
    for (const width of [360, 412, 480]) for (const x of [0, width / 2, width]) for (const y of [0, 450, 915]) {
      const c = radialCenter(x, y, width, 915);
      expect(c.x).toBeGreaterThanOrEqual(152);
      expect(c.x).toBeLessThanOrEqual(width - 152);
      expect(c.y).toBeGreaterThanOrEqual(152);
      expect(c.y).toBeLessThanOrEqual(763);
    }
    expect(radialCenter(206, 450, 412, 915)).toEqual({ x: 206, y: 450 });
  });
});
