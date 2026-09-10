import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GOLDEN_NAV_CSS,
  clampProgress,
  clampTab,
  goldenNavHtml,
  indicatorTransform,
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

  test("defines window.setProgress for native injectJavaScript", () => {
    const html = goldenNavHtml(1);
    expect(html).toContain("window.setProgress");
    expect(html).toContain(indicatorTransform(1));
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

  test("native indicator is compositor-driven with no left transition", () => {
    const block = GOLDEN_NAV_CSS.slice(GOLDEN_NAV_CSS.indexOf(".dev-mobile-pager-indicator"));
    expect(block).toContain("transition: none");
    expect(block).not.toContain("transition: left 220ms");
    expect(block).toContain("translate3d");
    expect(block).toContain("will-change: transform");
  });

  test("chrome pads the 50px pager so the gold glow is inside the WebView", () => {
    expect(GOLDEN_NAV_CSS).toContain("padding: 15px 16px");
    expect(GOLDEN_NAV_CSS).not.toMatch(/\.dash-appnav \{[^}]*height: 60px/);
  });
});

describe("native AppNav wiring", () => {
  test("does not freeze the WebView HTML on tab 1", () => {
    const src = readFileSync(join(import.meta.dir, "AppNav.tsx"), "utf8");
    expect(src).not.toContain("goldenNavHtml(1)");
    expect(src).toContain("navSetProgressScript");
    expect(src).toContain("goldenNavHtml(");
    expect(src).toContain("setProgress");
  });

  test("WebView wrap is tall enough that the 18px gold glow is not squared off", () => {
    const src = readFileSync(join(import.meta.dir, "AppNav.tsx"), "utf8");
    expect(src).toContain("height: 80");
    expect(src).not.toMatch(/wrap: \{ height: 60/);
  });
});

describe("MainPager scroll wiring", () => {
  test("forwards onPageScroll so the pill can track the drag", () => {
    const native = readFileSync(join(import.meta.dir, "MainPager.native.tsx"), "utf8");
    const types = readFileSync(join(import.meta.dir, "MainPager.tsx"), "utf8");
    expect(types).toContain("onPageScroll");
    expect(native).toContain("onPageScroll");
  });
});
