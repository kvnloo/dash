import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GOLD_SRGB,
  NAV_CHROME_HEIGHT,
  NAV_DOT_LEFT,
  NAV_DOT_SIZE,
  NAV_DOT_TOP,
  NAV_PAGER_HEIGHT,
  NAV_PAGER_PAD,
  NAV_PAGER_WIDTH,
  NAV_PILL_HEIGHT,
  NAV_SLOT_WIDTH,
} from "../app/src/components/golden-nav";
import {
  ROOT,
  checkNavDots,
  decodePng,
  encodePng,
  requireNavDots,
  type RgbaImage,
} from "./assert-nav-dots";

const GOLD = hex(GOLD_SRGB);
const PAGER = [12, 13, 11, 255] as const;
const DOT_ON = [0x21, 0x1b, 0x10, 255] as const;
const DOT_OFF = [0x83, 0x7f, 0x74, 255] as const;

function hex(s: string): readonly [number, number, number, number] {
  const body = s.startsWith("#") ? s.slice(1) : s;
  const n = Number.parseInt(body, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

function image(width: number, height: number, fill: readonly number[]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill[0] ?? 0;
    data[i * 4 + 1] = fill[1] ?? 0;
    data[i * 4 + 2] = fill[2] ?? 0;
    data[i * 4 + 3] = fill[3] ?? 255;
  }
  return { width, height, data };
}

function fillRect(
  img: RgbaImage,
  x: number,
  y: number,
  w: number,
  h: number,
  color: readonly number[],
): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(img.width, x + w);
  const y1 = Math.min(img.height, y + h);
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (py * img.width + px) * 4;
      img.data[i] = color[0] ?? 0;
      img.data[i + 1] = color[1] ?? 0;
      img.data[i + 2] = color[2] ?? 0;
      img.data[i + 3] = color[3] ?? 255;
    }
  }
}

/** 144×50 pager: gold pill on tab 1, three 4px dots. `dotTop` is the Yoga top inside each 44px slot. */
function paintPager(dotTop: number, gaps: readonly [number, number] = [NAV_SLOT_WIDTH, NAV_SLOT_WIDTH]): RgbaImage {
  const img = image(NAV_PAGER_WIDTH, NAV_PAGER_HEIGHT, PAGER);
  const pillX = NAV_PAGER_PAD + NAV_SLOT_WIDTH;
  const pillY = NAV_PAGER_PAD;
  fillRect(img, pillX, pillY, NAV_SLOT_WIDTH, NAV_PILL_HEIGHT, GOLD);
  const x0 = NAV_PAGER_PAD + NAV_DOT_LEFT;
  const xs = [x0, x0 + gaps[0], x0 + gaps[0] + gaps[1]];
  for (let i = 0; i < 3; i++) {
    fillRect(img, xs[i] ?? 0, NAV_PAGER_PAD + dotTop, NAV_DOT_SIZE, NAV_DOT_SIZE, i === 1 ? DOT_ON : DOT_OFF);
  }
  return img;
}

describe("inspect-nav.yaml is not enough", () => {
  test("the screenshot-only flow has no geometry assertion", () => {
    const yaml = readFileSync(join(ROOT, ".maestro/inspect-nav.yaml"), "utf8");
    expect(yaml).toContain("takeScreenshot");
    expect(yaml).not.toContain("assertVisible");
    expect(yaml).not.toMatch(/assert-nav-dots/);
  });
});

describe("nav-dots Maestro flow", () => {
  test("opens Main without relaunching Expo Go", () => {
    const yaml = readFileSync(join(ROOT, ".maestro/nav-dots.yaml"), "utf8");
    const commands = yaml.replace(/#.*$/gm, "");
    expect(commands).not.toMatch(/\blaunchApp\b/);
    expect(commands).not.toMatch(/\bstopApp\b/);
    expect(yaml).toContain("Bots");
    expect(yaml).toContain("Chats");
    expect(yaml).toContain("Orchestra");
    expect(yaml).toContain("takeScreenshot");
    expect(yaml).toContain("Primary mobile workspace");
  });
});

describe("checkNavDots", () => {
  test("pins the 60px chrome / 4px centered-dot contract", () => {
    expect(NAV_CHROME_HEIGHT).toBe(60);
    expect(NAV_DOT_SIZE).toBe(4);
    expect(NAV_DOT_TOP).toBe((NAV_PILL_HEIGHT - NAV_DOT_SIZE) / 2);
    expect(NAV_DOT_TOP).toBe(20);
    expect(NAV_SLOT_WIDTH).toBe(46);
    expect(NAV_DOT_LEFT).toBe(21);
  });

  test("passes when three 4px dots sit in the gold-pill vertical center", () => {
    const result = checkNavDots(paintPager(NAV_DOT_TOP));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.dots).toHaveLength(3);
    const pillCy = result.pill.y + result.pill.h / 2;
    for (const dot of result.dots) {
      expect(Math.abs(dot.cy - pillCy)).toBeLessThanOrEqual(1);
    }
    const gap0 = result.dots[1].cx - result.dots[0].cx;
    const gap1 = result.dots[2].cx - result.dots[1].cx;
    expect(gap0).toBe(NAV_SLOT_WIDTH);
    expect(gap1).toBe(NAV_SLOT_WIDTH);
  });

  test("fails when Yoga collapses the dots to the top of the pill", () => {
    const result = checkNavDots(paintPager(0));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected off-center dots to fail");
    expect(result.reason).toMatch(/vertically centered/i);
  });

  test("fails when dots are not evenly spaced horizontally", () => {
    const result = checkNavDots(paintPager(NAV_DOT_TOP, [NAV_SLOT_WIDTH, NAV_SLOT_WIDTH + 12]));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected uneven spacing to fail");
    expect(result.reason).toMatch(/evenly spaced/i);
  });

  test("requireNavDots throws on the top-collapse screenshot", () => {
    expect(() => requireNavDots(paintPager(0))).toThrow(/vertically centered/i);
  });
});

describe("png roundtrip", () => {
  test("encode/decode keeps gold and dots", () => {
    const src = paintPager(NAV_DOT_TOP);
    const png = encodePng(src);
    const out = decodePng(png);
    expect(out.width).toBe(src.width);
    expect(out.height).toBe(src.height);
    expect(checkNavDots(out).ok).toBe(true);
  });
});
