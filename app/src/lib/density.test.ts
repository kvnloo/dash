import { describe, expect, test } from "bun:test";
import { DEFAULT_DENSITY, INFO_LEVELS, LAYOUTS, LAYOUT_LABEL, DEFAULT_PREFS, densityReducer, layoutSizing, parseInfo, parseLayout, parsePrefs, resolveDensity, stepLayout, toInfoLevel, type DensityPrefs } from "./density";

describe("info level mapping", () => {
  test("axis values and defaults are pinned", () => {
    expect(INFO_LEVELS).toEqual([1, 2, 3, 4, 5]);
    expect(LAYOUTS).toEqual(["compact", "comfortable", "spacious"]);
    expect(LAYOUT_LABEL).toEqual({ compact: "Compact", comfortable: "Comfortable", spacious: "Spacious" });
    expect(DEFAULT_DENSITY).toEqual({ layout: "comfortable", info: 3 });
  });
  test("a continuous dial snaps to five levels", () => {
    expect([-3, 0, 1, 1.49, 1.5, 2, 2.6, 3, 4.4, 4.5, 5, 9].map(toInfoLevel)).toEqual([1, 1, 1, 1, 2, 2, 3, 3, 4, 5, 5, 5]);
    expect(toInfoLevel(Number.NaN)).toBe(3);
    expect(toInfoLevel(Number.POSITIVE_INFINITY)).toBe(3);
  });
  test("parsers accept the old Rich name and reject junk", () => {
    expect(parseLayout("rich")).toBe("spacious");
    expect(parseLayout("compact")).toBe("compact");
    expect(parseLayout("spacious")).toBe("spacious");
    expect(parseLayout("huge")).toBe("comfortable");
    expect(parseInfo(4)).toBe(4);
    expect(parseInfo("4")).toBe(3);
  });
  test("layout steps clamp at both ends", () => {
    expect(stepLayout("compact", -1)).toBe("compact");
    expect(stepLayout("compact", 1)).toBe("comfortable");
    expect(stepLayout("comfortable", 1)).toBe("spacious");
    expect(stepLayout("spacious", 1)).toBe("spacious");
    expect(stepLayout("spacious", -2)).toBe("compact");
  });
});

describe("density reducer", () => {
  test("unscoped writes the global default; scoped writes an override only", () => {
    const a = densityReducer(DEFAULT_PREFS, { type: "info", value: 5 });
    expect(a.global).toEqual({ layout: "comfortable", info: 5 });
    expect(a.screens).toEqual({});
    const b = densityReducer(a, { type: "layout", value: "compact", scope: "orchestra" });
    expect(b.global).toEqual(a.global);
    expect(b.screens).toEqual({ orchestra: { layout: "compact" } });
    const c = densityReducer(b, { type: "info", value: 1.2, scope: "orchestra" });
    expect(c.screens.orchestra).toEqual({ layout: "compact", info: 1 });
  });
  test("step moves an axis from the resolved base", () => {
    const base = { layout: "comfortable" as const, info: 3 as const };
    expect(densityReducer(DEFAULT_PREFS, { type: "step", axis: "info", delta: 2, base }).global.info).toBe(5);
    expect(densityReducer(DEFAULT_PREFS, { type: "step", axis: "info", delta: -7, base }).global.info).toBe(1);
    expect(densityReducer(DEFAULT_PREFS, { type: "step", axis: "layout", delta: 1, base, scope: "chat:x" }).screens["chat:x"]).toEqual({ layout: "spacious" });
  });
  test("clear removes one override and is a no-op when absent", () => {
    const prefs: DensityPrefs = { global: DEFAULT_PREFS.global, screens: { trace: { info: 2 }, lab: { info: 4 } } };
    expect(densityReducer(prefs, { type: "clear", scope: "trace" }).screens).toEqual({ lab: { info: 4 } });
    expect(densityReducer(prefs, { type: "clear", scope: "nope" })).toBe(prefs);
  });
});

describe("resolution and persistence", () => {
  const prefs: DensityPrefs = { global: { layout: "comfortable", info: 3 }, screens: { chat: { layout: "compact" }, "chat:a": { info: 5 }, orchestra: { info: 1 } } };
  test("chat override beats screen override beats global, per axis", () => {
    expect(resolveDensity(prefs)).toEqual({ layout: "comfortable", info: 3 });
    expect(resolveDensity(prefs, "orchestra")).toEqual({ layout: "comfortable", info: 1 });
    expect(resolveDensity(prefs, "chat")).toEqual({ layout: "compact", info: 3 });
    expect(resolveDensity(prefs, "chat", "a")).toEqual({ layout: "compact", info: 5 });
    expect(resolveDensity(prefs, "chat", "b")).toEqual({ layout: "compact", info: 3 });
  });
  test("parsePrefs round-trips and repairs bad shapes", () => {
    expect(parsePrefs(JSON.parse(JSON.stringify(prefs)))).toEqual(prefs);
    expect(parsePrefs(null)).toBe(DEFAULT_PREFS);
    expect(parsePrefs("x")).toBe(DEFAULT_PREFS);
    expect(parsePrefs({ global: { layout: "rich", info: 9 }, screens: { a: 3, b: { info: 0 } } })).toEqual({ global: { layout: "spacious", info: 5 }, screens: { b: { info: 1 } } });
    expect(parsePrefs({})).toEqual(DEFAULT_PREFS);
    expect(parsePrefs({ global: 5, screens: 7 })).toEqual(DEFAULT_PREFS);
    expect(parsePrefs({ global: null, screens: null })).toEqual(DEFAULT_PREFS);
  });
});

describe("layout sizing", () => {
  test("Spacious stays within 1.25x Comfortable on every spacing token", () => {
    const m = layoutSizing("comfortable"), s = layoutSizing("spacious"), c = layoutSizing("compact");
    expect([c.rowMin, m.rowMin, s.rowMin]).toEqual([44, 60, 72]);
    expect([c.padding, m.padding, s.padding]).toEqual([8, 12, 15]);
    expect([c.gap, m.gap, s.gap]).toEqual([4, 8, 10]);
    expect([c.tileMin, m.tileMin, s.tileMin]).toEqual([100, 136, 164]);
    expect([c.plotMin, m.plotMin, s.plotMin]).toEqual([44, 68, 84]);
    for (const key of ["rowMin", "padding", "gap", "tileMin", "plotMin"] as const) expect(s[key] / m[key]).toBeLessThanOrEqual(1.25);
  });
});
