import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GEL, MOTION_MS, PRESS_SCALE, SNAP, snappy, settle, fade, nav, press, entranceDelay, navDuration, navProgress, settleTiming, criticalProgress } from "../motion";

describe("motion springs", () => {
  test("shared tokens bound actual spring duration and forbid layout overshoot", () => {
    expect(snappy).toEqual({ duration: 150, easing: criticalProgress });
    expect(settle).toEqual({ duration: 180, easing: criticalProgress });
    expect(fade).toEqual({ duration: 120 });
    expect(nav).toEqual({ duration: 140 });
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
    expect(navDuration(1, 0)).toBe(140);
    expect(navDuration(1, -20)).toBe(140);
    expect(navDuration(0, 20)).toBe(140);
    expect(navDuration(1, 1)).toBe(140);
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
    expect(composer).toContain("multiline scrollEnabled");
    expect(composer).toContain("editingQueue && styles.previewInput");
    expect(composer).toContain("maxHeight: 148");
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


describe("post-Lab motion contracts", () => {
  test("new finite animations use shared system-reduced tokens", () => {
    for (const file of ["InteractiveTile.tsx", "TileGestures.tsx", "NumberTicker.tsx"]) {
      const source = readFileSync(join(import.meta.dir, file), "utf8");
      expect(source).toContain("ReduceMotion.System");
      expect(source).not.toMatch(/duration:\s*\d/);
      expect(source).not.toContain("withSpring");
    }
    const ambient = readFileSync(join(import.meta.dir, "OrbMotion.tsx"), "utf8");
    expect(ambient).toContain("ambient(6000, true)");
  });
  test("native-stack does not rely on an iOS-only duration cap for Android", () => {
    const app = readFileSync(join(import.meta.dir, "../../App.tsx"), "utf8");
    expect(app).toContain('animation: "none"');
    expect(app).not.toContain("animationDuration:");
  });
});

describe("MOTION.md tokens", () => {
  test("spring constants are critically damped and match criticalProgress timing", async () => {
    const { criticalSpring, dampingRatio, SPRING } = await import("../motion");
    for (const ms of [100, 150, 180]) {
      const spring = criticalSpring(ms);
      expect(dampingRatio(spring)).toBeCloseTo(1, 10);
      expect(spring.overshootClamping).toBe(true);
      // omega * t = 9 at the deadline, the same point criticalProgress normalizes to 1.
      expect(Math.sqrt(spring.stiffness / spring.mass) * ms / 1000).toBeCloseTo(9, 10);
    }
    expect(SPRING.snappy).toEqual(criticalSpring(snappy.duration));
    expect(SPRING.settle.stiffness).toBeLessThan(SPRING.snappy.stiffness);
  });

  test("distance-based duration is monotone, sub-linear and bounded", async () => {
    const { distanceDuration } = await import("../motion");
    expect(distanceDuration(0, 120, 180, 400)).toBe(120);
    expect(distanceDuration(400, 120, 180, 400)).toBe(180);
    expect(distanceDuration(4000, 120, 180, 400)).toBe(180);
    expect(distanceDuration(-400, 120, 180, 400)).toBe(180);
    expect(distanceDuration(100, 120, 180, 400)).toBe(150);
    expect(distanceDuration(Number.NaN, 120, 180, 400)).toBe(120);
    expect(distanceDuration(50, 120, 180, 0)).toBe(120);
    let previous = 0;
    for (let d = 0; d <= 500; d += 5) {
      const ms = distanceDuration(d, 120, 180, 400);
      expect(ms).toBeGreaterThanOrEqual(previous);
      expect(ms).toBeLessThanOrEqual(180);
      previous = ms;
    }
  });

  test("tab jumps scale with page distance; one page and swipes keep nav timing", async () => {
    const { pageDuration } = await import("../motion");
    expect(pageDuration(0)).toBe(nav.duration);
    expect(pageDuration(0.4)).toBe(nav.duration);
    expect(pageDuration(1)).toBe(nav.duration);
    expect(pageDuration(-1)).toBe(nav.duration);
    expect(pageDuration(2)).toBe(163);
    expect(pageDuration(4)).toBe(settle.duration);
    expect(pageDuration(9)).toBe(settle.duration);
    expect(navDuration(3, 0)).toBe(pageDuration(3));
    expect(navDuration(-3, 0)).toBe(pageDuration(3));
    expect(navDuration(3, 0, true)).toBe(0);
    // A fast fling toward a far page still finishes early, never later than the page budget.
    expect(navDuration(3, 100)).toBe(80);
  });

  test("window morph time follows travel and never exceeds the release budget", async () => {
    const { morphDuration } = await import("../motion");
    expect(morphDuration(0, 800)).toBe(fade.duration);
    expect(morphDuration(400, 800)).toBe(settle.duration);
    expect(morphDuration(-400, 800)).toBe(settle.duration);
    expect(morphDuration(100, 800)).toBeGreaterThan(fade.duration);
    expect(morphDuration(100, 800)).toBeLessThan(settle.duration);
  });

  test("reduce motion removes spatial motion and keeps the crossfade", async () => {
    const { REDUCED_MOTION, crossfade, pressScaleFor } = await import("../motion");
    expect(REDUCED_MOTION).toEqual({ spatial: "jump", opacity: "crossfade" });
    expect(crossfade.duration).toBe(fade.duration);
    expect(MOTION_MS.crossfade).toBe(fade.duration);
    expect(pressScaleFor(PRESS_SCALE.row, true)).toBe(1);
    expect(pressScaleFor(PRESS_SCALE.row, false)).toBe(PRESS_SCALE.row);
  });

  test("the five most visible transitions use the shared tokens", () => {
    const read = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");
    // 1. Tab pager: page-distance timing comes through navDuration.
    expect(read("GesturePager.tsx")).toContain("navDuration(distance, velocity, reduced)");
    // 2. Chat window open morph: distance-based duration, crossfade-only under reduce motion.
    const chat = read("ChatWindow.tsx");
    expect(chat).toContain("morphDuration(from.translateY, height)");
    expect(chat).toContain("useReducedMotion()");
    expect(chat).toContain("morphFrame(progress.value, from, reduced)");
    // 3. Press feedback: no squash under reduce motion.
    expect(read("PressScale.tsx")).toContain("pressScaleFor(scaleTo, useReducedMotion())");
    // 4. Connection pill and queued stack: shared status crossfade, no literal durations.
    for (const file of ["ConnectionPill.tsx", "QueuedStack.tsx"]) {
      const source = read(file);
      expect(source).toContain("statusIn");
      expect(source).not.toMatch(/duration\(\d/);
      expect(source).not.toContain("MOTION_MS.exit)");
    }
    // 5. Mic hold pill: every finite animation honors reduce motion.
    const mic = read("MicButton.tsx");
    expect(mic).not.toMatch(/withTiming\([^)]*,\s*snappy\)/);
    expect(mic.match(/spatial\(snappy\)/g)?.length).toBe(4);
    const enter = read("motion-enter.ts");
    expect(enter).toContain("FadeIn.duration(MOTION_MS.crossfade)");
    expect(enter).toContain("ReduceMotion.Never");
  });
});
