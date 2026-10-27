import { describe, expect, test } from "bun:test";
import { colors } from "../theme";
import {
  CLASSIC_SCENE, GLASS_DEFAULTS, GLASS_PRESETS, NO_BLUR_TINT_BOOST, TINT_FLOOR, TINT_MAX, TINT_SAFE,
  clampBlur, clampTint, contrast, hexToRgb, minTintFor, over, parseGlassPrefs, presetOf, resolveGlassScene,
} from "./glass-theme";

const text = hexToRgb(colors.text);
const bg = hexToRgb(colors.bg);
const onWallpaper = (alpha: number, wallpaper: string) => contrast(text, over(bg, alpha, hexToRgb(wallpaper)));

describe("contrast math", () => {
  test("WCAG reference points", () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
  });
  test("minTintFor is the smallest passing alpha", () => {
    const a = minTintFor(colors.text, colors.bg, "#ffffff", 4.5);
    expect(onWallpaper(a, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(onWallpaper(a - 0.01, "#ffffff")).toBeLessThan(4.5);
  });
});

describe("tint bounds", () => {
  test("floor keeps body text AA over mid-grey; safe keeps it over white", () => {
    expect(onWallpaper(TINT_FLOOR, "#808080")).toBeGreaterThanOrEqual(4.5);
    expect(onWallpaper(TINT_SAFE, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(TINT_FLOOR).toBeLessThan(TINT_SAFE);
  });
  test("frosted default is AA over a white wallpaper", () => {
    expect(onWallpaper(GLASS_PRESETS.frosted.tint, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(GLASS_DEFAULTS.tint).toBe(GLASS_PRESETS.frosted.tint);
  });
  test("clamps", () => {
    expect(clampTint(0)).toBeCloseTo(TINT_FLOOR, 2);
    expect(clampTint(2)).toBe(TINT_MAX);
    expect(clampTint(Number.NaN)).toBe(GLASS_DEFAULTS.tint);
    expect(clampBlur(-3)).toBe(0);
    expect(clampBlur(999)).toBe(60);
  });
});

describe("prefs", () => {
  test("garbage falls back to defaults", () => {
    expect(parseGlassPrefs(null)).toEqual(GLASS_DEFAULTS);
    expect(parseGlassPrefs({ mode: "neon", tint: "x" })).toEqual(GLASS_DEFAULTS);
  });
  test("round-trips classic and presets", () => {
    expect(parseGlassPrefs({ mode: "classic", tint: 0.85, blur: 40 }).mode).toBe("classic");
    expect(presetOf(GLASS_PRESETS.deep)).toBe("deep");
    expect(presetOf({ tint: 0.77, blur: 3 })).toBeNull();
  });
});

describe("resolveGlassScene", () => {
  test("classic build is always Classic", () => {
    expect(resolveGlassScene(GLASS_DEFAULTS, false, true)).toBe(CLASSIC_SCENE);
  });
  test("Classic mode in the glass build paints today's opaque background", () => {
    const s = resolveGlassScene({ ...GLASS_DEFAULTS, mode: "classic" }, true, true);
    expect(s).toBe(CLASSIC_SCENE);
    expect(s.root).toBe(colors.bg);
    expect(s.windowBlur).toBe(0);
  });
  test("glass with blur: translucent root and the requested radius", () => {
    const s = resolveGlassScene(GLASS_DEFAULTS, true, true);
    expect(s.active).toBe(true);
    expect(s.root).toMatch(/^rgba\(/);
    expect(s.windowBlur).toBe(GLASS_DEFAULTS.blur);
    expect(s.tint).toBe(GLASS_DEFAULTS.tint);
  });
  test("battery saver (blur off) falls back to a stronger tint, no radius", () => {
    const s = resolveGlassScene(GLASS_DEFAULTS, true, false);
    expect(s.windowBlur).toBe(0);
    expect(s.tint).toBeCloseTo(Math.min(TINT_MAX, GLASS_DEFAULTS.tint + NO_BLUR_TINT_BOOST), 2);
    expect(resolveGlassScene(GLASS_DEFAULTS, true, null).windowBlur).toBe(0);
  });
  test("chat window over Main stays nearly opaque", () => {
    expect(resolveGlassScene({ ...GLASS_DEFAULTS, ...GLASS_PRESETS.clear }, true, true).window).toMatch(/,0\.9[4-9]\)$/);
  });
});
