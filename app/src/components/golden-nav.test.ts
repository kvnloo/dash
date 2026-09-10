import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GOLDEN_NAV_CSS,
  NAV_PAGER_HEIGHT,
  NAV_PAGER_PAD,
  NAV_PAGER_WIDTH,
  NAV_PILL_HEIGHT,
  NAV_SLOT_WIDTH,
  clampProgress,
  clampTab,
  goldenNavHtml,
  indicatorFrames,
  indicatorTransform,
  indicatorTranslateX,
  navSetProgressScript,
  navSetTabScript,
  pageProgress,
  parseNavMessage,
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

  test("clamps overdrag so the pill stays in the stadium", () => {
    expect(pageProgress(0, -0.4)).toBe(0);
    expect(pageProgress(2, 0.3)).toBe(2);
  });
});

describe("clampProgress", () => {
  test("keeps fractional offsets", () => {
    expect(clampProgress(0.25)).toBe(0.25);
    expect(clampProgress(1.99)).toBe(1.99);
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

  test("chrome is the 60px collapsed bar with gold glow and inset, not an 80px spacer", () => {
    const src = readFileSync(join(import.meta.dir, "AppNav.tsx"), "utf8");
    expect(src).toContain("NAV_CHROME_HEIGHT");
    expect(src).toContain("GOLD_GLOW");
    expect(src).toContain("styles.glow");
    expect(src).toContain("styles.spec");
    expect(src).toContain("styles.shade");
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
});
