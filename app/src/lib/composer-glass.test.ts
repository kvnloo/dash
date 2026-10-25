import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { COMPOSER_GLASS_RIM, composerGlassPolicy } from "./composer-glass";
import { colors } from "../theme";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("modern Android retains expo-blur only with a live transcript target", () => {
  for (const sdk of [31, 33, 35, 36]) {
    expect(composerGlassPolicy("android", sdk, true).blur).toBe(true);
    expect(composerGlassPolicy("android", sdk, false).blur).toBe(false);
  }
});

test("old Android and unknown platforms render the opaque floor without native blur", () => {
  for (const sdk of [0, 23, 30, NaN, Infinity, -Infinity]) {
    const policy = composerGlassPolicy("android", sdk, true);
    expect(policy.blur).toBe(false);
    expect(policy.shieldColor).toBe(colors.surfaceRaised);
  }
  expect(composerGlassPolicy("windows", 99, true).blur).toBe(false);
});

test("iOS and web preserve glass blur while sharing the readable backing", () => {
  for (const platform of ["ios", "web"]) {
    for (const target of [true, false]) {
      const policy = composerGlassPolicy(platform, 0, target);
      expect(policy.blur).toBe(true);
      expect(policy.backingColor).toBe(colors.surfaceRaised);
      expect(policy.shieldColor).toBe(colors.surfaceRaised);
    }
  }
});

test("both composer shields are actually opaque night tokens, not translucent tint", () => {
  const policy = composerGlassPolicy("android", 35, true);
  // Exactly six hex digits means 100% alpha; rgba glass.fillRaised does not.
  expect(policy.backingColor).toMatch(/^#[a-fA-F0-9]{6}$/);
  expect(policy.shieldColor).toMatch(/^#[a-fA-F0-9]{6}$/);
  expect(policy.backingColor).not.toBe(colors.surface);
  expect(COMPOSER_GLASS_RIM).toBeGreaterThan(0);
  expect(COMPOSER_GLASS_RIM).toBeLessThanOrEqual(2);
  const theme = source("../theme.ts");
  expect(theme).toContain('surfaceRaised: "#151611"');
  expect(theme).toContain('surfaceRaised: "#111111"');
});

test("the new composer glass renders a full-coverage ink shield ABOVE native blur", () => {
  const dock = source("../components/ComposerGlassDock.tsx");
  const blurPos = dock.indexOf("<GlassSurface");
  const shieldPos = dock.indexOf('testID="composer-ink-shield"');
  expect(blurPos).toBeGreaterThan(-1);
  expect(shieldPos).toBeGreaterThan(blurPos);
  expect(dock).toContain("blur={policy.blur}");
  expect(dock).toContain("blurTarget={policy.blur ? blurTarget : undefined}");
  expect(dock).toContain("pointerEvents=\"box-none\"");
  expect(dock).toContain("backgroundColor: policy.shieldColor");
  expect(dock).toContain("backgroundColor: policy.backingColor");
  expect(dock).toContain("overflow: \"hidden\"");
  expect(dock).toContain("contentStyle={styles.glassInset}");
  expect(dock).toContain("{children}");
});

test("the existing chat-to-composer blur path is present and cannot regress silently", () => {
  const chat = source("../screens/ChatScreen.tsx");
  const composer = source("../components/Composer.tsx");
  const glass = source("../components/GlassSurface.tsx");
  const appPackage = JSON.parse(source("../../package.json"));

  expect(appPackage.dependencies["expo-blur"]).toBeDefined();
  expect(chat).toContain("<BlurTargetView ref={blurTarget}");
  expect(chat).toContain("blurTarget={liveOn ? undefined : blurTarget}");
  expect(composer).toContain("blurTarget={blurTarget}");
  expect(composer.includes("<GlassSurface blur") || composer.includes("<ComposerGlassDock")).toBe(true);
  expect(glass).toContain("pointerEvents=\"none\"");
  expect(glass).toContain('blurMethod={blurTarget ? "dimezisBlurViewSdk31Plus" : "none"}');
  expect(glass).toContain("variant === \"raised\" ? glass.fillRaised");
});
