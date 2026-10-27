import { describe, expect, test } from "bun:test";
import {
  jumpTarget,
  quickScroll,
  quickScrollBadgeLabel,
  type QuickScrollInput,
  type QuickScrollState,
} from "./quick-scroll";

function fixture(overrides: Partial<QuickScrollInput> = {}): QuickScrollInput {
  return {
    contentHeight: 2600,
    viewportHeight: 600,
    offset: 100,
    keyboardHeight: 0,
    composerHeight: 56,
    bottomInset: 24,
    following: false,
    unseen: 0,
    ...overrides,
  };
}

describe("quickScroll visibility", () => {
  const cases = [
    { name: "scrolling a long transcript", contentHeight: 2600, viewportHeight: 600, offset: 100, following: false, visible: true },
    { name: "tiny content", contentHeight: 400, viewportHeight: 600, offset: 0, following: false, visible: false },
    { name: "content exactly fills the viewport", contentHeight: 600, viewportHeight: 600, offset: 0, following: false, visible: false },
    { name: "explicit following mode", contentHeight: 2600, viewportHeight: 600, offset: 100, following: true, visible: false },
    { name: "exactly one viewport from the end", contentHeight: 2600, viewportHeight: 600, offset: 1400, following: false, visible: false },
    { name: "one pixel past the entry threshold", contentHeight: 2600, viewportHeight: 600, offset: 1399, following: false, visible: true },
    { name: "near the end", contentHeight: 2600, viewportHeight: 600, offset: 1980, following: false, visible: false },
    { name: "overscrolled beyond the end", contentHeight: 2600, viewportHeight: 600, offset: 9000, following: false, visible: false },
  ];
  for (const entry of cases) {
    test(entry.name, () => {
      expect(quickScroll(fixture(entry)).down.visible).toBe(entry.visible);
    });
  }

  test("up needs an upward user gesture more than two viewports from the start", () => {
    const at = (offset: number, direction: QuickScrollInput["direction"]) =>
      quickScroll(fixture({ contentHeight: 4000, offset, direction })).up.visible;
    expect(at(1200, "up")).toBe(false);
    expect(at(1201, "up")).toBe(true);
    expect(at(1201, "down")).toBe(false);
    expect(at(1201, "none")).toBe(false);
    expect(at(1201, undefined)).toBe(false);
    expect(at(0, "up")).toBe(false);
    expect(quickScroll(fixture({ contentHeight: 300, offset: 500, direction: "up" })).up.visible).toBe(false);
  });

  test("down hysteresis uses the previous result and hides only within 40px", () => {
    const offsets = [1700, 2010, 2459, 2460, 2430, 1999];
    const expected = [true, true, true, false, false, true];
    let previous: QuickScrollState | undefined;
    for (let i = 0; i < offsets.length; i++) {
      const next = quickScroll(fixture({
        contentHeight: 3000,
        viewportHeight: 500,
        offset: offsets[i]!,
        previous,
      }));
      expect(next.down.visible).toBe(expected[i]);
      previous = next;
    }
    expect(quickScroll(fixture({ contentHeight: 3000, viewportHeight: 500, offset: 2459 })).down.visible).toBe(false);
  });

  test("following and unscrollable content override a previously visible control", () => {
    const visible = quickScroll(fixture());
    expect(visible.down.visible).toBe(true);
    expect(quickScroll(fixture({ following: true, previous: visible })).down.visible).toBe(false);
    expect(quickScroll(fixture({ contentHeight: 250, previous: visible })).down.visible).toBe(false);
    expect(quickScroll(fixture({ viewportHeight: 0, previous: visible })).down.visible).toBe(false);
  });
});

describe("quickScroll keyboard and composer placement", () => {
  const cases = [
    { name: "closed IME uses the bottom safe area", keyboardHeight: 0, bottom: 88 },
    { name: "negative IME height lifts above the keyboard", keyboardHeight: -240, bottom: 304 },
    { name: "positive height follows KeyboardController semantics: closed", keyboardHeight: 240, bottom: 88 },
    { name: "huge keyboard is clamped", keyboardHeight: -800, bottom: 300 },
  ];
  for (const entry of cases) {
    test(entry.name, () => {
      const state = quickScroll(fixture({ keyboardHeight: entry.keyboardHeight }));
      expect(state.down.bottom).toBe(entry.bottom);
      expect(state.up.top).toBe(8);
    });
  }

  test("huge composer, negative insets, zero viewport and invalid measurements are safe", () => {
    expect(quickScroll(fixture({ composerHeight: 10000 })).down.bottom).toBe(300);
    expect(quickScroll(fixture({ composerHeight: -10, bottomInset: -5 })).down.bottom).toBe(8);
    expect(quickScroll(fixture({ keyboardHeight: Number.NaN })).down.bottom).toBe(88);
    const zero = quickScroll(fixture({ viewportHeight: 0, contentHeight: 3000, direction: "up" }));
    expect(zero).toEqual({
      down: { visible: false, bottom: 0 },
      up: { visible: false, top: 0 },
    });
    const tiny = quickScroll(fixture({ viewportHeight: 10, composerHeight: 0, bottomInset: 0 }));
    expect(tiny.down.bottom).toBe(5);
    expect(tiny.up.top).toBe(5);
    expect(quickScroll(fixture({ viewportHeight: Number.NaN, composerHeight: Number.POSITIVE_INFINITY })).down.bottom).toBe(0);
  });
});

describe("unseen badge", () => {
  test("zero or invalid counts hide; positive counts retain numeric data", () => {
    expect(quickScroll(fixture()).down.badge).toBeUndefined();
    expect(quickScrollBadgeLabel(0)).toBeUndefined();
    expect(quickScrollBadgeLabel(undefined)).toBeUndefined();
    expect(quickScroll(fixture({ unseen: -10 })).down.badge).toBeUndefined();
    expect(quickScroll(fixture({ unseen: Number.POSITIVE_INFINITY })).down.badge).toBeUndefined();
    expect(quickScrollBadgeLabel(Number.NaN)).toBeUndefined();
    expect(quickScroll(fixture({ unseen: 1 })).down.badge).toBe(1);
    expect(quickScrollBadgeLabel(1)).toBe("1");
  });

  test("badge label caps at 99+, while the state keeps the count", () => {
    const under = quickScroll(fixture({ unseen: 99 }));
    const over = quickScroll(fixture({ unseen: 123 }));
    expect(under.down.badge).toBe(99);
    expect(quickScrollBadgeLabel(under.down.badge)).toBe("99");
    expect(over.down.badge).toBe(123);
    expect(quickScrollBadgeLabel(over.down.badge)).toBe("99+");
    expect(quickScrollBadgeLabel(100)).toBe("99+");
  });
});

describe("jumpTarget", () => {
  test("up targets the start and down targets the last reachable offset", () => {
    expect(jumpTarget("up", 3000, 600)).toBe(0);
    expect(jumpTarget("down", 3000, 600)).toBe(2400);
    expect(jumpTarget("down", 400, 600)).toBe(0);
    expect(jumpTarget("down", 600, 600)).toBe(0);
  });

  test("never returns negative or non-finite offsets", () => {
    expect(jumpTarget("down", -100, 600)).toBe(0);
    expect(jumpTarget("down", Number.POSITIVE_INFINITY, 600)).toBe(0);
    expect(jumpTarget("down", 3000, Number.NaN)).toBe(3000);
    expect(jumpTarget("down", 3000, Number.POSITIVE_INFINITY)).toBe(3000);
  });
});
