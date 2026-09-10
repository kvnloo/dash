import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GOLDEN_NAV_CSS,
  NAV_CHROME_HEIGHT,
  NAV_PAGER_HEIGHT,
  NAV_PAGER_PAD,
  NAV_PAGER_RADIUS,
  NAV_PAGER_WIDTH,
  NAV_PILL_HEIGHT,
  NAV_PILL_RADIUS,
  NAV_SLOT_WIDTH,
  OVERSCROLL,
  PAGE_DAMPING,
  PAGE_LAG_PX,
  PAGE_MASS,
  PAGE_STIFFNESS,
  PAGE_STRETCH,
  PAGE_STRETCH_CAP,
  PAGE_VOLUME,
  PILL_DAMPING,
  PILL_MASS,
  PILL_STIFFNESS,
  PILL_STRETCH,
  PILL_STRETCH_CAP,
  PILL_TRAVEL,
  PILL_VOLUME,
  clampProgress,
  clampSettled,
  clampTab,
  goldenNavHtml,
  indicatorFrames,
  indicatorTransform,
  indicatorTranslateX,
  navSetProgressScript,
  navSetTabScript,
  pageProgress,
  pageStep,
  pageStretch,
  parseNavMessage,
  pillStep,
  pillStretch,
} from "./golden-nav";

/** sRGB of oklch(0.80 0.075 80) — Android WebView must paint this when oklch is dropped. */
const GOLD_HEX = "#d7b986";
const GOLD_68 = "rgba(215, 185, 134, 0.68)";
const GOLD_RIM = "rgb(230, 210, 178)";
const DEV_NAV_96 = "rgba(12, 13, 11, 0.874)";

describe("clampTab", () => {
  test("keeps 0, 1, 2", () => {
    expect(clampTab(0)).toBe(0);
    expect(clampTab(1)).toBe(1);
    expect(clampTab(2)).toBe(2);
  });

  test("clamps out of range", () => {
    expect(clampTab(-4)).toBe(0);
    expect(clampTab(9)).toBe(2);
    expect(clampTab(1.4)).toBe(1);
    expect(clampTab(1.6)).toBe(2);
  });
});

describe("pageProgress", () => {
  test("adds PagerView position + offset without rounding", () => {
    expect(pageProgress(0, 0)).toBe(0);
    expect(pageProgress(0, 0.37)).toBe(0.37);
    expect(pageProgress(1, 0.5)).toBe(1.5);
    expect(pageProgress(1, 1)).toBe(2);
  });

  test("keeps overscroll so the pill can leave slot 0 then bounce", () => {
    expect(pageProgress(0, -0.4)).toBeCloseTo(-0.4);
    expect(pageProgress(2, 0.3)).toBeCloseTo(2.3);
    expect(pageProgress(0, -2)).toBe(-OVERSCROLL);
    expect(pageProgress(2, 2)).toBe(2 + OVERSCROLL);
  });
});

describe("clampProgress", () => {
  test("keeps fractional offsets", () => {
    expect(clampProgress(0.25)).toBe(0.25);
    expect(clampProgress(1.99)).toBe(1.99);
  });

  test("allows a full dummy-page pull past 0 and 2", () => {
    expect(clampProgress(-0.8)).toBe(-0.8);
    expect(clampProgress(2.8)).toBe(2.8);
    expect(clampProgress(-4)).toBe(-OVERSCROLL);
    expect(clampProgress(9)).toBe(2 + OVERSCROLL);
  });
});

describe("clampSettled", () => {
  test("snaps overscroll back onto a real tab", () => {
    expect(clampSettled(-0.7)).toBe(0);
    expect(clampSettled(2.4)).toBe(2);
    expect(clampSettled(1.2)).toBe(1.2);
  });
});

describe("indicatorTransform", () => {
  test("moves one slot per page using the indicator's own width", () => {
    expect(indicatorTransform(0)).toBe("translate3d(calc(0 * 100%), 0, 0)");
    expect(indicatorTransform(1)).toBe("translate3d(calc(1 * 100%), 0, 0)");
    expect(indicatorTransform(1.5)).toBe("translate3d(calc(1.5 * 100%), 0, 0)");
    expect(indicatorTransform(2)).toBe("translate3d(calc(2 * 100%), 0, 0)");
  });
});

describe("indicatorTranslateX", () => {
  test("is one 46px slot per page so native translateX matches the stadium", () => {
    expect(NAV_PAGER_WIDTH).toBe(144);
    expect(NAV_PAGER_HEIGHT).toBe(50);
    expect(NAV_PAGER_PAD).toBe(3);
    expect(NAV_SLOT_WIDTH).toBe(46);
    expect(NAV_PILL_HEIGHT).toBe(44);
    expect(indicatorTranslateX(0)).toBe(0);
    expect(indicatorTranslateX(1)).toBe(46);
    expect(indicatorTranslateX(1.5)).toBe(69);
    expect(indicatorTranslateX(2)).toBe(92);
  });
});

describe("pill gel", () => {
  test("at rest the pill is unstretched", () => {
    const rest = pillStretch(1, 1, 0);
    expect(rest.scaleX).toBe(1);
    expect(rest.scaleY).toBe(1);
  });

  test("mid-swipe and lag both grow X and squash Y so it keeps volume", () => {
    const mid = pillStretch(0.5, 0.5, 0);
    expect(mid.scaleX).toBeGreaterThan(1);
    expect(mid.scaleY).toBeLessThan(1);

    const pull = pillStretch(0, 1, 0);
    expect(pull.scaleX).toBeGreaterThan(mid.scaleX);
    expect(pull.scaleY).toBeLessThan(mid.scaleY);
  });

  test("one physics step moves toward the pager target instead of snapping", () => {
    const next = pillStep(0, 0, 1, 1 / 60);
    expect(next.pos).toBeGreaterThan(0);
    expect(next.pos).toBeLessThan(0.4);
    expect(next.vel).toBeGreaterThan(0);
  });

  test("can travel past page 0 toward -1 instead of sticking at the edge", () => {
    const next = pillStep(0, -1.8, -1, 1 / 60);
    expect(next.pos).toBeLessThan(0);
    expect(next.pos).toBeGreaterThanOrEqual(-PILL_TRAVEL);
  });
});

describe("page gel", () => {
  test("is the same family as the pill but heavier so one step accelerates less", () => {
    expect(PAGE_MASS).toBeGreaterThan(PILL_MASS);
    const pill = pillStep(0, 0, 1, 1 / 60);
    const page = pageStep(0, 0, 1, 1 / 60);
    expect(page.pos).toBeGreaterThan(0);
    expect(page.pos).toBeLessThan(pill.pos);
    expect(page.vel).toBeLessThan(pill.vel);
  });

  test("stretches less than the pill because the page is larger", () => {
    const pill = pillStretch(0, 1, 0);
    const page = pageStretch(0, 1, 0);
    expect(page.scaleX).toBeGreaterThan(1);
    expect(page.scaleX).toBeLessThan(pill.scaleX);
    expect(page.scaleY).toBeLessThan(1);
    expect(page.scaleY).toBeGreaterThan(pill.scaleY);
  });
});

describe("indicatorFrames", () => {
  test("samples every settle frame so the pill matches pager offset linearly", () => {
    const frames = indicatorFrames(1, 2, 10);
    expect(frames).toHaveLength(11);
    for (let i = 0; i < frames.length; i++) {
      const progress = 1 + i / 10;
      expect(frames[i]).toBeCloseTo(progress * NAV_SLOT_WIDTH, 8);
    }
  });

  test("does not jump to the destination on the first settle frame", () => {
    const frames = indicatorFrames(0, 1, 8);
    expect(frames[0]).toBe(0);
    expect(frames[1]).toBeCloseTo(NAV_SLOT_WIDTH / 8, 8);
    expect(frames[frames.length - 1]).toBe(NAV_SLOT_WIDTH);
    expect(frames[1]).not.toBe(NAV_SLOT_WIDTH);
  });
});

describe("goldenNavHtml", () => {
  test("bakes the requested tab into markup so the first paint is not stuck on Chats", () => {
    const bots = goldenNavHtml(0);
    expect(bots).toContain('aria-label="Bots" class="is-active"');
    expect(bots).toContain(indicatorTransform(0));

    const orch = goldenNavHtml(2);
    expect(orch).toContain('aria-label="Orchestra" class="is-active"');
    expect(orch).toContain(indicatorTransform(2));
    expect(orch).not.toContain('aria-label="Bots" class="is-active"');
  });

  test("paints real 4px dots, not empty buttons hoping ::after survives Android WebView", () => {
    const html = goldenNavHtml(1);
    expect(html).toContain('class="dev-mobile-pager-dot"');
    expect(html.split("dev-mobile-pager-dot").length - 1).toBeGreaterThanOrEqual(3);
  });
});

describe("navSetProgressScript", () => {
  test("writes the fractional offset with no CSS transition lag", () => {
    const js = navSetProgressScript(1.25);
    expect(js).toContain(indicatorTransform(1.25));
    expect(js).toContain("translate3d");
    expect(js).not.toContain("Math.round");
    expect(js.trim().endsWith("true;")).toBe(true);
  });
});

describe("navSetTabScript", () => {
  test("still snaps the active dot on a settled page", () => {
    const js = navSetTabScript(2);
    expect(js).toContain(indicatorTransform(2));
    expect(js).toContain("is-active");
    expect(js.trim().endsWith("true;")).toBe(true);
  });
});

describe("parseNavMessage", () => {
  test("reads tab / expand / menu posts from the WebView", () => {
    expect(parseNavMessage('{"type":"tab","index":0}')).toEqual({ type: "tab", index: 0 });
    expect(parseNavMessage('{"type":"expand"}')).toEqual({ type: "expand" });
    expect(parseNavMessage('{"type":"menu"}')).toEqual({ type: "menu" });
    expect(parseNavMessage("nope")).toBeNull();
    expect(parseNavMessage('{"type":"tab","index":9}')).toBeNull();
  });
});

describe("GOLDEN_NAV_CSS colors and clip", () => {
  test("ships sRGB gold fallbacks Android WebView can paint", () => {
    expect(GOLDEN_NAV_CSS).toContain(GOLD_HEX);
    expect(GOLDEN_NAV_CSS).toContain(GOLD_68);
    expect(GOLDEN_NAV_CSS).toContain(GOLD_RIM);
    expect(GOLDEN_NAV_CSS).toContain(DEV_NAV_96);
    expect(GOLDEN_NAV_CSS).toContain("#211b10");
    expect(GOLDEN_NAV_CSS).toContain("#B4AFA3");
    expect(GOLDEN_NAV_CSS).toContain("#837F74");
  });

  test("indicator uses the baked 68% gold, not only color-mix/oklch", () => {
    const block = GOLDEN_NAV_CSS.slice(GOLDEN_NAV_CSS.indexOf(".dev-mobile-pager-indicator"));
    expect(block).toContain(GOLD_68);
    expect(block).toContain(GOLD_RIM);
  });

  test("does not clip the stadium or gold glow", () => {
    expect(GOLDEN_NAV_CSS).toContain("overflow: visible");
    expect(GOLDEN_NAV_CSS).toContain(".dev-mobile-pager {");
    const pager = GOLDEN_NAV_CSS.slice(GOLDEN_NAV_CSS.indexOf(".dev-mobile-pager {"));
    expect(pager.slice(0, 400)).toContain("overflow: visible");
  });

  test("web/CSS indicator is compositor-driven with no left transition", () => {
    const block = GOLDEN_NAV_CSS.slice(GOLDEN_NAV_CSS.indexOf(".dev-mobile-pager-indicator"));
    expect(block).toContain("transition: none");
    expect(block).not.toContain("transition: left 220ms");
    expect(block).toContain("translate3d");
    expect(block).toContain("will-change: transform");
  });

  test("dots are real 4px elements, not a ::after that Android software WebView drops", () => {
    expect(GOLDEN_NAV_CSS).toContain(".dev-mobile-pager-dot");
    expect(GOLDEN_NAV_CSS).toContain("width: 4px");
    expect(GOLDEN_NAV_CSS).toContain("height: 4px");
  });
});


describe("pinned geometry (mutation canaries)", () => {
  test("collapsed chrome is 60px with a 144x50 squircle pager", () => {
    expect(NAV_CHROME_HEIGHT).toBe(60);
    expect(NAV_PAGER_WIDTH).toBe(144);
    expect(NAV_PAGER_HEIGHT).toBe(50);
    expect(NAV_PAGER_PAD).toBe(3);
    expect(NAV_PAGER_RADIUS).toBe(16);
    expect(NAV_PILL_RADIUS).toBe(16);
    expect(NAV_PILL_HEIGHT).toBe(44);
    expect(NAV_SLOT_WIDTH).toBe(46);
    expect(NAV_SLOT_WIDTH * 3).toBe(NAV_PAGER_WIDTH - NAV_PAGER_PAD * 2);
  });

  test("pill gel is lighter than the page gel", () => {
    expect(PILL_MASS).toBe(0.4);
    expect(PILL_STIFFNESS).toBe(240);
    expect(PILL_DAMPING).toBe(13);
    expect(PILL_STRETCH).toBe(0.28);
    expect(PILL_STRETCH_CAP).toBe(1.34);
    expect(PILL_VOLUME).toBe(0.38);
    expect(PAGE_MASS).toBe(1.15);
    expect(PAGE_STIFFNESS).toBe(150);
    expect(PAGE_DAMPING).toBe(17);
    expect(PAGE_STRETCH).toBe(0.1);
    expect(PAGE_STRETCH_CAP).toBe(1.12);
    expect(PAGE_VOLUME).toBe(0.38);
    expect(PAGE_LAG_PX).toBe(26);
    expect(OVERSCROLL).toBe(1);
    expect(PAGE_MASS).toBeGreaterThan(PILL_MASS);
    expect(PILL_TRAVEL).toBe(0.55);
  });

  test("dots sit in the pill center: three equal slots, not stuck to the top", () => {
    const src = readFileSync(join(import.meta.dir, "AppNav.tsx"), "utf8");
    const tabs = src.match(/tabs: \{[\s\S]*?\n  \},/)?.[0] ?? "";
    const tab = src.match(/tab: \{[\s\S]*?\n  \},/)?.[0] ?? "";
    expect(tabs).toContain("top: NAV_PAGER_PAD");
    expect(tabs).toContain("height: NAV_PILL_HEIGHT");
    expect(tabs).toContain("width: NAV_SLOT_WIDTH * 3");
    expect(tabs).toContain('flexDirection: "row"');
    expect(tab).toContain("width: NAV_SLOT_WIDTH");
    expect(tab).toContain("height: NAV_PILL_HEIGHT");
    expect(tab).toContain('alignItems: "center"');
    expect(tab).toContain('justifyContent: "center"');
    expect(src).toContain("width: 4");
    expect(src).toContain("height: 4");
    expect(src).toContain("borderRadius: 2");
    expect(tabs).not.toContain("top: 0");
  });
});

describe("native AppNav wiring", () => {
  test("does not drive the pill through a WebView JS bridge", () => {
    const src = readFileSync(join(import.meta.dir, "AppNav.tsx"), "utf8");
    expect(src).not.toContain("react-native-webview");
    expect(src).not.toContain("injectJavaScript");
    expect(src).not.toContain("androidLayerType");
    expect(src).toContain("react-native-reanimated");
    expect(src).toContain("indicatorTranslateX");
    expect(src).toContain("setProgress");
  });

  test("paints three 4dp dots as native views above the gold pill", () => {
    const src = readFileSync(join(import.meta.dir, "AppNav.tsx"), "utf8");
    expect(src).toContain("width: 4");
    expect(src).toContain("height: 4");
    expect(src).toContain("#211b10");
    expect(src).toContain("#837F74");
  });

  test("does not snap the pill to the integer tab when a flick settles", () => {
    const src = readFileSync(join(import.meta.dir, "AppNav.tsx"), "utf8");
    expect(src).not.toContain("progress.value = clampProgress(tab)");
  });

  test("dots are circular and the gold pill is not a hardware-texture square", () => {
    const src = readFileSync(join(import.meta.dir, "AppNav.tsx"), "utf8");
    expect(src).toContain("borderRadius: 2");
    expect(src).toContain("overflow: \"hidden\"");
    expect(src).not.toContain("renderToHardwareTextureAndroid");
    expect(src).not.toContain("elevation:");
    expect(src).toContain("android_ripple");
    expect(src).toContain("transparent");
  });

  test("stadium layout does not eat 2px of slot width with a Yoga border", () => {
    const src = readFileSync(join(import.meta.dir, "AppNav.tsx"), "utf8");
    expect(src).toContain("NAV_PAGER_WIDTH");
    expect(src).toContain("NAV_SLOT_WIDTH");
    expect(src).toContain("NAV_PILL_HEIGHT");
    const pagerStyle = src.match(/pager: \{[\s\S]*?\n  \},/)?.[0] ?? "";
    expect(pagerStyle).toContain("width: NAV_PAGER_WIDTH");
    expect(pagerStyle).not.toContain("borderWidth");
    expect(src).toContain("styles.hair");
  });

  test("tab hit targets fill the 44px slot so the 4px dots sit in the pill center", () => {
    const src = readFileSync(join(import.meta.dir, "AppNav.tsx"), "utf8");
    expect(src).toContain("height: NAV_PILL_HEIGHT");
    expect(src).toContain("width: NAV_SLOT_WIDTH");
    const tabStyle = src.match(/tab: \{[\s\S]*?\n  \},/)?.[0] ?? "";
    expect(tabStyle).toContain("width: NAV_SLOT_WIDTH");
    expect(tabStyle).toContain("height: NAV_PILL_HEIGHT");
    expect(tabStyle).toContain('alignItems: "center"');
    expect(tabStyle).toContain('justifyContent: "center"');
    expect(tabStyle).not.toContain("flex: 1");
    expect(tabStyle).not.toContain("transform");
  });

  test("gold pill is a UI-thread gel: spring follow, stretch X, squash Y", () => {
    const src = readFileSync(join(import.meta.dir, "AppNav.tsx"), "utf8");
    expect(src).toContain("useFrameCallback");
    expect(src).toContain("pillStep");
    expect(src).toContain("pillStretch");
    expect(src).toContain("scaleX");
    expect(src).toContain("scaleY");
  });

  test("follows overscroll past page 0 instead of clamping the gel to the first slot", () => {
    const src = readFileSync(join(import.meta.dir, "AppNav.tsx"), "utf8");
    expect(src).not.toContain("progress.value < 0 ? 0");
    expect(src).toContain("pillStep(follow.value, vel.value, progress.value");
  });

  test("pager outline uses the same squircle radius as the gold pill", () => {
    const src = readFileSync(join(import.meta.dir, "AppNav.tsx"), "utf8");
    expect(src).toContain("NAV_PAGER_RADIUS");
    expect(src).toContain("NAV_PILL_RADIUS");
    expect(NAV_PAGER_RADIUS).toBe(NAV_PILL_RADIUS);
    expect(GOLDEN_NAV_CSS).toContain(`border-radius: ${NAV_PAGER_RADIUS}px`);
    expect(src).not.toContain("borderRadius: 23");
  });

  test("chrome is the 60px collapsed bar with inset pill, not an 80px spacer", () => {
    const src = readFileSync(join(import.meta.dir, "AppNav.tsx"), "utf8");
    expect(src).toContain("NAV_CHROME_HEIGHT");
    expect(src).toContain("GOLD_68");
    expect(src).toContain("styles.spec");
    expect(src).toContain("styles.shade");
    expect(src).not.toContain("styles.glow");
    expect(src).not.toContain("height: 80");
    expect(src).not.toContain("react-native-webview");
  });
});

describe("MainPager scroll wiring", () => {
  test("forwards onPageScroll so the pill can track the drag", () => {
    const native = readFileSync(join(import.meta.dir, "MainPager.native.tsx"), "utf8");
    const types = readFileSync(join(import.meta.dir, "MainPager.tsx"), "utf8");
    expect(types).toContain("onPageScroll");
    expect(native).toContain("onPageScroll");
  });

  test("writes pager offset on the UI thread so a fling is not JS-bridged", () => {
    const native = readFileSync(join(import.meta.dir, "MainPager.native.tsx"), "utf8");
    expect(native).toContain("createAnimatedComponent");
    expect(native).toContain("useEvent");
    expect(native).toContain("onPageScroll");
    expect(native).toContain("worklet");
  });

  test("does not call setPage again when onPageSelected reports the flick target", () => {
    const native = readFileSync(join(import.meta.dir, "MainPager.native.tsx"), "utf8");
    expect(native).toContain("fromPager");
  });

  test("does not keep all three panes in the GPU layer during a fling", () => {
    const native = readFileSync(join(import.meta.dir, "MainPager.native.tsx"), "utf8");
    expect(native).toContain("offscreenPageLimit={1}");
  });

  test("snaps pill progress on onPageSelected so Android's dummy page-0 scroll cannot stick", () => {
    const native = readFileSync(join(import.meta.dir, "MainPager.native.tsx"), "utf8");
    expect(native).toContain("armed.value === 0");
    expect(native).toContain("progress.value = real");
  });

  test("wraps real pages in bounce sentinels so page 0 can overscroll to -1 then snap back", () => {
    const native = readFileSync(join(import.meta.dir, "MainPager.native.tsx"), "utf8");
    expect(native).toContain("bounce-start");
    expect(native).toContain("bounce-end");
    expect(native).toContain("e.position + e.offset - BOUNCE");
    expect(native).toContain("inner.current?.setPage(BOUNCE)");
    expect(native).toContain('overScrollMode="always"');
    expect(native).toContain("pageWidth");
    expect(native).toContain("width: pageWidth");
    expect(native).not.toContain('overScrollMode="never"');
  });

  test("main page body follows the pager with heavier gel, not a layout height anim", () => {
    const src = readFileSync(join(import.meta.dir, "../screens/MainScreen.tsx"), "utf8");
    expect(src).toContain("pageStep");
    expect(src).toContain("pageStretch");
    expect(src).toContain("PAGE_LAG_PX");
    expect(src).toContain("useFrameCallback");
    expect(src).toContain("pageWidth={width}");
    expect(src).not.toContain("height: pagerProgress");
  });
});
