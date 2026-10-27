import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CLOSE_HIT, PILL_GAP, pillGeometry, pillReserve } from "./chat-window";
import {
  fullscreenChromeReserve,
  fullscreenCloseBounds,
  fullscreenCloseLabel,
  fullscreenPillLabel,
  fullscreenPillState,
} from "./a11y-fullscreen-chat-chrome";

const source = readFileSync(new URL("../components/FullscreenChatChrome.tsx", import.meta.url), "utf8");

describe("full-screen chat chrome accessible names and state", () => {
  test("title alone is a useful pill label", () => {
    expect(fullscreenPillLabel("Hermes", [])).toBe("Hermes");
    expect(fullscreenPillLabel("  Research agent  ", ["  "])).toBe("Research agent");
  });

  test("title and every observed status are included in order", () => {
    expect(fullscreenPillLabel("Hermes", ["running tool", "2 queued", "voice listening"]))
      .toBe("Hermes, running tool, 2 queued, voice listening");
    expect(fullscreenPillLabel("Hermes", [" offline ", "", " working "]))
      .toBe("Hermes, offline, working");
  });

  test("empty or whitespace-only title falls back to the harness name provided", () => {
    expect(fullscreenPillLabel("", [], "Claude")).toBe("Claude");
    expect(fullscreenPillLabel("   ", ["offline"], "  Codex  ")).toBe("Codex, offline");
    expect(fullscreenPillLabel("", [], "")).toBe("Chat");
  });

  test("close is always named and both collapsed/expanded states are truthful", () => {
    expect(fullscreenCloseLabel()).toBe("Close chat");
    expect(fullscreenPillState(false)).toEqual({ expanded: false });
    expect(fullscreenPillState(true)).toEqual({ expanded: true });
  });
});

describe("full-screen close target and cutout safety", () => {
  test("left and right target stay 44 DIP or larger next to a safe-area pill", () => {
    const geometry = pillGeometry({ width: 390, insetTop: 24, cutout: null });
    const left = fullscreenCloseBounds(geometry, 390, "left");
    const right = fullscreenCloseBounds(geometry, 390, "right");

    for (const target of [left, right]) {
      expect(target.width).toBeGreaterThanOrEqual(CLOSE_HIT);
      expect(target.height).toBeGreaterThanOrEqual(CLOSE_HIT);
      expect(target.top).toBeGreaterThanOrEqual(0);
      expect(target.left).toBeGreaterThanOrEqual(0);
      expect(target.left + target.width).toBeLessThanOrEqual(390);
    }
    expect(left.left).toBeLessThan(right.left);
    expect(left.left + left.width + 8).toBeLessThanOrEqual(geometry.left);
    expect(right.left).toBeGreaterThanOrEqual(geometry.left + geometry.width + 8);
  });

  test("edge-to-edge cutout pill moves both close targets beneath the hardware hole", () => {
    const geometry = pillGeometry({
      width: 320, insetTop: 24,
      cutout: { x: 146, y: 0, width: 28, height: 24 },
    });
    expect(geometry.hole).not.toBeNull();
    for (const side of ["left", "right"] as const) {
      const close = fullscreenCloseBounds(geometry, 320, side);
      expect(close.width).toBe(CLOSE_HIT);
      expect(close.height).toBe(CLOSE_HIT);
      expect(close.top).toBeGreaterThanOrEqual(geometry.top + geometry.height + 8);
      expect(fullscreenChromeReserve(geometry, 320, side, 24))
        .toBeGreaterThanOrEqual(close.top + CLOSE_HIT + PILL_GAP);
    }
  });

  test("reserve accounts for the pill, close button and status inset", () => {
    for (const width of [320, 390, 430]) {
      const geometry = pillGeometry({ width, insetTop: 30, cutout: null });
      for (const side of ["left", "right"] as const) {
        const reserve = fullscreenChromeReserve(geometry, width, side, 30);
        expect(reserve).toBeGreaterThanOrEqual(pillReserve(geometry, 30));
        expect(reserve).toBeGreaterThanOrEqual(fullscreenCloseBounds(geometry, width, side).top + CLOSE_HIT + PILL_GAP);
      }
    }
  });
});

describe("full-screen chrome source wiring (unit contract, not rendered or native proof)", () => {
  test("exposes accessible close X and togglable pill on separate real buttons", () => {
    expect(source).toContain('testID="chat-fullscreen-close"');
    expect(source).toContain('testID="chat-fullscreen-pill"');
    expect(source).toContain('accessibilityRole="button"');
    expect(source).toContain("accessibilityLabel={fullscreenCloseLabel()}");
    expect(source).toContain("accessibilityLabel={fullscreenPillLabel(title, status)}");
    expect(source).toContain("accessibilityState={fullscreenPillState(pillOpen)}");
    expect(source).toContain('onPress={() => { haptic.tap(); onClose(); }}');
    expect(source).toContain('onPress={() => { haptic.select(); onTogglePill(); }}');
    expect(source).toContain('<Feather name="x"');
  });

  test("uses supplied geometry, reserved status slot and an unpainted native cutout", () => {
    expect(source).toContain("fullscreenCloseBounds(geometry, windowWidth, closeSide)");
    expect(source).toContain("geometry.left, top: geometry.top");
    expect(source).toContain("const hitPad = Math.max(0, (PILL_HIT - geometry.height) / 2)");
    expect(source).toContain("hitSlop={{ top: hitPad, bottom: hitPad }}");
    expect(source).toContain('testID="chat-fullscreen-pill-hole"');
    expect(source).toContain('fillRule="evenodd"');
    expect(source).toContain('testID="chat-fullscreen-pill-status"');
    expect(source).toContain("colors.danger");
    expect(source).toContain("glass.fillRaised");
    expect(source).toContain('pointerEvents="box-none"');
  });

  test("has no lifecycle side effects, header or bespoke animations", () => {
    expect(source).not.toContain("ScreenHeader");
    expect(source).not.toContain("readCutout");
    expect(source).not.toContain("withTiming");
    expect(source).not.toContain("useSharedValue");
    expect(source).toContain("animated={false}");
    expect(source).toContain('style={[styles.closeHit, close]}');
  });
});
