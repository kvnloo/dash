import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GOLDEN_NAV_CSS,
  clampTab,
  goldenNavHtml,
  indicatorLeft,
  navSetTabScript,
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

describe("indicatorLeft", () => {
  test("matches collapsed pager pad 3px / 3 slots", () => {
    expect(indicatorLeft(0)).toBe("calc(3px + 0 * (100% - 6px) / 3)");
    expect(indicatorLeft(1)).toBe("calc(3px + 1 * (100% - 6px) / 3)");
    expect(indicatorLeft(2)).toBe("calc(3px + 2 * (100% - 6px) / 3)");
  });
});

describe("goldenNavHtml", () => {
  test("bakes the requested tab into markup so the first paint is not stuck on Chats", () => {
    const bots = goldenNavHtml(0);
    expect(bots).toContain('aria-label="Bots" class="is-active"');
    expect(bots).toContain(`style="left:${indicatorLeft(0)}"`);

    const orch = goldenNavHtml(2);
    expect(orch).toContain('aria-label="Orchestra" class="is-active"');
    expect(orch).toContain(`style="left:${indicatorLeft(2)}"`);
    expect(orch).not.toContain('aria-label="Bots" class="is-active"');
  });

  test("defines window.setTab for native injectJavaScript", () => {
    const html = goldenNavHtml(1);
    expect(html).toContain("window.setTab");
    expect(html).toContain(indicatorLeft(1));
  });
});

describe("navSetTabScript", () => {
  test("moves the gold without depending on a prior window.setTab bind", () => {
    const js = navSetTabScript(2);
    expect(js).toContain(indicatorLeft(2));
    expect(js).toContain("is-active");
    expect(js.trim().endsWith("true;")).toBe(true);
    expect(js).toContain("querySelectorAll");
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

describe("GOLDEN_NAV_CSS colors", () => {
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
});

describe("native AppNav wiring", () => {
  test("does not freeze the WebView HTML on tab 1", () => {
    const src = readFileSync(join(import.meta.dir, "AppNav.tsx"), "utf8");
    expect(src).not.toContain("goldenNavHtml(1)");
    expect(src).toContain("navSetTabScript");
    expect(src).toContain("goldenNavHtml(");
  });
});
