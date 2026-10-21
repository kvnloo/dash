import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GEL, MOTION_MS, PRESS_SCALE, SNAP, snappy, settle, fade, nav, press, entranceDelay, navDuration, navProgress, settleTiming, criticalProgress } from "../motion";

describe("motion springs", () => {
  test("shared tokens bound actual spring duration and forbid layout overshoot", () => {
    expect(snappy).toEqual({ duration: 150, easing: criticalProgress });
    expect(settle).toEqual({ duration: 180, easing: criticalProgress });
    expect(fade).toEqual({ duration: 120 });
    expect(nav).toEqual({ duration: 160 });
    expect(press).toEqual({ duration: 70 });
    expect(GEL).toBe(snappy); expect(SNAP).toBe(snappy);
    expect(snappy.duration).toBe(150);
    expect(settle.duration).toBe(180);
    expect(criticalProgress(0)).toBe(0); expect(criticalProgress(1)).toBe(1);
    expect(criticalProgress(0.5)).toBeCloseTo(0.94006, 4);
    for (const i of [0, 11, 12, 200]) expect(entranceDelay(i)).toBe(0);
  });

  test("velocity-aware navigation is bounded and reversible", () => {
    const release = settleTiming(1, 10);
    expect(release.duration).toBe(100); expect(release.easing(0.5)).toBeCloseTo(0.625);
    expect(navDuration(1, 0)).toBe(160);
    expect(navDuration(1, -20)).toBe(160);
    expect(navDuration(0, 20)).toBe(160);
    expect(navDuration(1, 1)).toBe(160);
    expect(navDuration(1, 10)).toBe(100);
    expect(navDuration(-1, -10)).toBe(100);
    expect(navDuration(1, 100)).toBe(80);
    expect(navDuration(1, 0, true)).toBe(0);
    expect(navProgress(0, 1, 10, 100)).toBe(0);
    expect(navProgress(1, 1, 10, 100)).toBe(1);
    expect(navProgress(0.5, 1, 10, 100)).toBeCloseTo(0.625);
    expect(navProgress(0.5, -1, -10, 100)).toBeCloseTo(0.625);
    expect(navProgress(0.5, 0, 10, 100)).toBeCloseTo(0.5);
    expect(navProgress(0.5, 1, -10, 100)).toBeCloseTo(0.5);
    expect(navProgress(0.5, 1, 1000, 100)).toBeCloseTo(0.875);
    for (const velocity of [-100, 0, 1, 10, 1000]) {
      let previous = 0;
      for (let i = 0; i <= 100; i++) {
        const current = navProgress(i / 100, 1, velocity, 160);
        expect(current).toBeGreaterThanOrEqual(previous - 1e-9);
        expect(current).toBeLessThanOrEqual(1);
        previous = current;
      }
    }
  });

  test("press scales stay on transform, not layout", () => {
    expect(PRESS_SCALE.row).toBe(0.985);
    expect(PRESS_SCALE.control).toBe(0.92);
    expect(PRESS_SCALE.nav).toBe(0.9);
    expect(PRESS_SCALE.row).toBeGreaterThan(0.97);
    expect(PRESS_SCALE.row).toBeLessThan(1);
    expect(PRESS_SCALE.control).toBeLessThan(PRESS_SCALE.row);
    expect(PRESS_SCALE.nav).toBeLessThan(PRESS_SCALE.control);
    expect(PRESS_SCALE.nav).toBeGreaterThan(0.85);
  });

  test("enter/exit stay under 300ms", () => {
    expect(MOTION_MS.enter).toBe(150);
    expect(MOTION_MS.exit).toBe(120);
    expect(MOTION_MS.stagger).toBe(0);
    expect(MOTION_MS.enter).toBeLessThanOrEqual(300);
    expect(MOTION_MS.exit).toBeLessThanOrEqual(180);
    expect(MOTION_MS.stagger).toBeLessThanOrEqual(50);
  });
});

describe("PressScale wiring", () => {
  test("PressScale springs scale on the UI thread", () => {
    const src = readFileSync(join(import.meta.dir, "PressScale.tsx"), "utf8");
    expect(src).toContain("withTiming");
    expect(src).toContain("transform");
    expect(src).toContain("ReduceMotion.System");
    expect(src).toContain("press");
    expect(src).not.toContain("width:");
  });

  test("Pressable owns layout; inner Animated.View owns scale", () => {
    const src = readFileSync(join(import.meta.dir, "PressScale.tsx"), "utf8");
    expect(src).not.toContain("createAnimatedComponent");
    expect(src).not.toContain("AnimatedPressable");
    expect(src).toContain("Animated.View");
    expect(src).toContain("flex: 1");
    expect(src).toContain('alignItems: "center"');
    expect(src).toContain('justifyContent: "center"');
  });

  test("composer controls stay mounted; search pops in without FlashList entering", () => {
    const composer = readFileSync(join(import.meta.dir, "Composer.tsx"), "utf8");
    const search = readFileSync(join(import.meta.dir, "GlobalSearchBar.tsx"), "utf8");
    const chats = readFileSync(join(import.meta.dir, "../screens/panes/ChatsPane.tsx"), "utf8");
    const bots = readFileSync(join(import.meta.dir, "../screens/panes/BotsPane.tsx"), "utf8");
    expect(composer).toContain("styles.controls");
    expect(composer).toContain("multiline={false}");
    expect(composer).toContain("PressScale");
    expect(search).toContain("staggerUp");
    expect(search).toContain("popIn");
    expect(chats).toContain("PressScale");
    expect(chats).not.toContain("entering=");
    expect(bots).not.toContain("entering=");
  });

  test("header icons use the shared glass press feedback, not a glow overlay", () => {
    const nav = readFileSync(join(import.meta.dir, "ScreenHeader.tsx"), "utf8");
    expect(nav).toContain("<PressScale");
    expect(nav).toContain("haptic.select()");
    expect(nav).toContain("styles.circle");
    expect(nav).not.toContain("GOLD_GLOW");
    expect(nav).not.toContain("styles.glow");
  });
});
