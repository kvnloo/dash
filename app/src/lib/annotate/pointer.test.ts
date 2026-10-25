import { describe, expect, test } from "bun:test";
import { appendInkSample, pointerKind, pressureOf, routePointer, stylusEnters } from "./pointer";

describe("pointer routing", () => {
  test("raw UP adds its true local-DIP endpoint without fontScale/density multiplication or input mutation", () => {
    const down = appendInkSample([], 65, 285, 0.7, 1);
    const up = appendInkSample(down, 215, 385, 0.7, 2);
    expect(down).toEqual([65, 285, 0.7, 1]);
    expect(up).toEqual([65, 285, 0.7, 1, 215, 385, 0.7, 2]);
    const pressure = appendInkSample(up, 215, 385, 0.9, 3);
    expect(pressure).not.toBe(up); expect(pressure).toHaveLength(8);
    expect(pressure[6]).toBe(0.9);
    expect(appendInkSample(up, Number.NaN, 0, 0.5, 4)).toEqual(up);
  });
  test("maps Gesture Handler pointer types", () => {
    expect([0, 1, 2, 3, 4].map(pointerKind)).toEqual(["touch", "stylus", "mouse", "other", "other"]);
  });

  test("pen mode: only the stylus draws, fingers pass through to scroll", () => {
    expect(routePointer("stylus", true, 1)).toBe("draw");
    expect(routePointer("touch", true, 1)).toBe("pass");
    expect(routePointer("mouse", true, 1)).toBe("pass");
  });

  test("without pen mode one finger, mouse or pen draws", () => {
    expect(routePointer("touch", false, 1)).toBe("draw");
    expect(routePointer("mouse", false, 1)).toBe("draw");
    expect(routePointer("stylus", false, 1)).toBe("draw");
    expect(routePointer("other", false, 1)).toBe("pass");
  });

  test("two pointers never draw", () => {
    expect(routePointer("touch", false, 2)).toBe("pass");
    expect(routePointer("stylus", true, 2)).toBe("pass");
  });

  test("a stylus touch enters annotation only in pen mode and only when inactive", () => {
    expect(stylusEnters("stylus", true, false)).toBe(true);
    expect(stylusEnters("stylus", true, true)).toBe(false);
    expect(stylusEnters("stylus", false, false)).toBe(false);
    expect(stylusEnters("touch", true, false)).toBe(false);
  });

  test("pressure only from a stylus, clamped; missing or zero is mid", () => {
    expect(pressureOf("stylus", 0.8)).toBe(0.8);
    expect(pressureOf("stylus", 1.4)).toBe(1);
    expect(pressureOf("stylus", 0)).toBe(0.5);
    expect(pressureOf("stylus", undefined)).toBe(0.5);
    expect(pressureOf("stylus", Number.NaN)).toBe(0.5);
    expect(pressureOf("touch", 0.9)).toBe(0.5);
  });
});
