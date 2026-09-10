import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GEL, MOTION_MS, PRESS_SCALE, SNAP } from "../motion";

describe("motion springs", () => {
  test("press SNAP is snappier than the nav gel", () => {
    expect(SNAP.stiffness).toBeGreaterThan(GEL.stiffness);
    expect(SNAP.damping).toBeGreaterThan(GEL.damping);
    expect(SNAP.mass).toBeLessThan(GEL.mass);
  });

  test("press scales stay on transform, not layout", () => {
    expect(PRESS_SCALE.row).toBeGreaterThan(0.97);
    expect(PRESS_SCALE.row).toBeLessThan(1);
    expect(PRESS_SCALE.control).toBeLessThan(PRESS_SCALE.row);
    expect(PRESS_SCALE.nav).toBeLessThan(PRESS_SCALE.control);
    expect(PRESS_SCALE.nav).toBeGreaterThan(0.85);
  });

  test("enter/exit stay under 300ms", () => {
    expect(MOTION_MS.enter).toBeLessThanOrEqual(300);
    expect(MOTION_MS.exit).toBeLessThanOrEqual(180);
    expect(MOTION_MS.stagger).toBeLessThanOrEqual(50);
  });
});

describe("PressScale wiring", () => {
  test("PressScale springs scale on the UI thread", () => {
    const src = readFileSync(join(import.meta.dir, "PressScale.tsx"), "utf8");
    expect(src).toContain("withSpring");
    expect(src).toContain("transform");
    expect(src).toContain("ReduceMotion.System");
    expect(src).toContain("SNAP");
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

  test("composer and search send pop in without FlashList entering", () => {
    const composer = readFileSync(join(import.meta.dir, "Composer.tsx"), "utf8");
    const search = readFileSync(join(import.meta.dir, "GlobalSearchBar.tsx"), "utf8");
    const chats = readFileSync(join(import.meta.dir, "../screens/panes/ChatsPane.tsx"), "utf8");
    const bots = readFileSync(join(import.meta.dir, "../screens/panes/BotsPane.tsx"), "utf8");
    expect(composer).toContain("popIn");
    expect(composer).toContain("PressScale");
    expect(search).toContain("staggerUp");
    expect(search).toContain("popIn");
    expect(chats).toContain("PressScale");
    expect(chats).not.toContain("entering=");
    expect(bots).not.toContain("entering=");
  });

  test("native AppNav press scales circles, not a glow overlay", () => {
    const nav = readFileSync(join(import.meta.dir, "AppNav.tsx"), "utf8");
    expect(nav).toContain("PressScale");
    expect(nav).toContain("PRESS_SCALE.nav");
    expect(nav).not.toContain("GOLD_GLOW");
    expect(nav).not.toContain("styles.glow");
  });
});
