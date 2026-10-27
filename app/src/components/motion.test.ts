import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BOT_CHAT_MS, BOT_CHAT_OFFSETS, GEL, MOTION_MS, PRESS_SCALE, SNAP } from "../motion";

describe("motion springs", () => {
  test("press SNAP is snappier than the nav gel", () => {
    expect(GEL.mass).toBe(0.4);
    expect(GEL.stiffness).toBe(240);
    expect(GEL.damping).toBe(13);
    expect(SNAP.mass).toBe(0.32);
    expect(SNAP.stiffness).toBe(420);
    expect(SNAP.damping).toBe(22);
    expect(SNAP.stiffness).toBeGreaterThan(GEL.stiffness);
    expect(SNAP.damping).toBeGreaterThan(GEL.damping);
    expect(SNAP.mass).toBeLessThan(GEL.mass);
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
    expect(MOTION_MS.enter).toBe(240);
    expect(MOTION_MS.exit).toBe(140);
    expect(MOTION_MS.stagger).toBe(36);
    expect(MOTION_MS.enter).toBeLessThanOrEqual(300);
    expect(MOTION_MS.exit).toBeLessThanOrEqual(180);
    expect(MOTION_MS.stagger).toBeLessThanOrEqual(50);
  });

  test("bot-chat clock reuses MOTION_MS, not a second language", () => {
    expect(BOT_CHAT_MS.enter).toBe(MOTION_MS.enter);
    expect(BOT_CHAT_MS.exit).toBe(MOTION_MS.exit);
    expect(BOT_CHAT_MS.stagger).toBe(MOTION_MS.stagger);
    expect(BOT_CHAT_MS.enter).toBe(240);
    expect(BOT_CHAT_MS.exit).toBe(140);
    expect(BOT_CHAT_MS.stagger).toBe(36);
    expect(BOT_CHAT_MS.enter).toBeLessThan(300);
    expect(BOT_CHAT_MS.exit).toBeLessThan(300);
  });

  test("bot-chat offsets are small translateY, not layout", () => {
    expect(BOT_CHAT_OFFSETS.enterY).toBe(8);
    expect(BOT_CHAT_OFFSETS.exitY).toBe(8);
    expect(BOT_CHAT_OFFSETS.enterY).toBeGreaterThan(0);
    expect(BOT_CHAT_OFFSETS.enterY).toBeLessThanOrEqual(12);
    expect(BOT_CHAT_OFFSETS.exitY).toBeGreaterThan(0);
    expect(BOT_CHAT_OFFSETS.exitY).toBeLessThanOrEqual(12);
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

describe("bot-chat dash-motion library", () => {
  test("entry/exit use SNAP springs, transforms, opacity, ReduceMotion.System", () => {
    const src = readFileSync(join(import.meta.dir, "../dash-motion/index.ts"), "utf8");
    expect(src).toContain("from \"../motion\"");
    expect(src).toContain("SNAP");
    expect(src).toContain("BOT_CHAT_MS");
    expect(src).toContain("BOT_CHAT_OFFSETS");
    expect(src).toContain("GEL");
    expect(src).toContain("transform");
    expect(src).toContain("opacity");
    expect(src).toContain("ReduceMotion.System");
    expect(src).toContain("botChatEnter");
    expect(src).toContain("botChatExit");
    expect(src).not.toContain("GOLD_GLOW");
    expect(src).not.toContain("width:");
    expect(src).not.toContain("height:");
    expect(src).not.toContain("LayoutAnimation");
    expect(src).not.toContain("from \"react-native\"");
  });

  test("visual.json pins Reanimated 4 bot-chat constraints", () => {
    const visual = JSON.parse(
      readFileSync(join(import.meta.dir, "../catalog/encodings/visual.json"), "utf8"),
    ) as {
      runtime: string;
      properties: string[];
      maxDurationMs: number;
      reduceMotion: string;
      appNav: { goldGlow: boolean };
      flashList: { entering: boolean };
      botChat: { ms: string; offsets: { enterY: number; exitY: number } };
    };
    expect(visual.runtime).toBe("reanimated-4");
    expect(visual.properties).toEqual(["transform", "opacity"]);
    expect(visual.maxDurationMs).toBe(300);
    expect(visual.reduceMotion).toBe("ReduceMotion.System");
    expect(visual.appNav.goldGlow).toBe(false);
    expect(visual.flashList.entering).toBe(false);
    expect(visual.botChat.ms).toBe("BOT_CHAT_MS");
    expect(visual.botChat.offsets.enterY).toBe(8);
    expect(visual.botChat.offsets.exitY).toBe(8);
  });
});
