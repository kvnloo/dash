import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  quickScrollBadge,
  quickScrollLabel,
  quickScrollPosition,
  quickScrollSidePosition,
  shouldRenderQuickScroll,
} from "./a11y-quick-scroll";
import { controlMin, space } from "../theme";

const component = readFileSync(
  new URL("../components/QuickScrollButton.tsx", import.meta.url),
  "utf8",
);

describe("keyboard-aware QuickScrollButton accessibility", () => {
  test("zero and absent unread badges do not announce new messages", () => {
    expect(quickScrollLabel("down")).toBe("Jump to latest");
    expect(quickScrollLabel("down", 0)).toBe("Jump to latest");
    expect(quickScrollBadge()).toBeNull();
    expect(quickScrollBadge(0)).toBeNull();
  });

  test("one unread message is singular and multiple messages are plural", () => {
    expect(quickScrollLabel("down", 1)).toBe("Jump to latest, 1 new message");
    expect(quickScrollBadge(1)).toBe("1");
    expect(quickScrollLabel("down", 3)).toBe("Jump to latest, 3 new messages");
    expect(quickScrollBadge(3)).toBe("3");
    expect(quickScrollLabel("down", 99)).toBe("Jump to latest, 99 new messages");
  });

  test("counts above 99 consistently use the visible 99+ cap", () => {
    expect(quickScrollBadge(100)).toBe("99+");
    expect(quickScrollBadge(10000)).toBe("99+");
    expect(quickScrollLabel("down", 100)).toBe("Jump to latest, 99+ new messages");
    expect(quickScrollLabel("down", 10000)).toBe("Jump to latest, 99+ new messages");
  });

  test("jump to top does not misannounce down-direction unread counts", () => {
    for (const count of [undefined, 0, 1, 3, 99, 100]) {
      expect(quickScrollLabel("up", count)).toBe("Jump to top");
    }
  });

  test("malformed or fractional badge counts do not expose invalid labels", () => {
    for (const count of [-1, -100, Number.NaN, Number.POSITIVE_INFINITY, 0.5]) {
      expect(quickScrollBadge(count)).toBeNull();
      expect(quickScrollLabel("down", count)).toBe("Jump to latest");
    }
    expect(quickScrollBadge(1.9)).toBe("1");
  });

  test("invisible controls have no rendered touch target", () => {
    expect(shouldRenderQuickScroll(false)).toBe(false);
    expect(shouldRenderQuickScroll(true)).toBe(true);
    expect(component).toContain("if (!shouldRenderQuickScroll(visible)) return null;");
    // An exit animation could leave an invisible interactive native view behind.
    expect(component).not.toContain("exiting=");
    expect(component).toContain('pointerEvents="box-none"');
  });

  test("the placement is mirrored without moving the vertical keyboard offset", () => {
    expect(quickScrollSidePosition("left")).toEqual({ left: space.lg });
    expect(quickScrollSidePosition("right")).toEqual({ right: space.lg });
    expect(quickScrollPosition("down", 72, "left")).toEqual({ left: space.lg, bottom: 72 });
    expect(quickScrollPosition("down", 72, "right")).toEqual({ right: space.lg, bottom: 72 });
    expect(quickScrollPosition("up", 24, "left")).toEqual({ left: space.lg, top: 24 });
    expect(quickScrollPosition("up", 24, "right")).toEqual({ right: space.lg, top: 24 });
    expect(quickScrollPosition("down", -8, "right")).toEqual({ right: space.lg, bottom: 0 });
    expect(quickScrollPosition("up", Number.NaN, "left")).toEqual({ left: space.lg, top: 0 });
  });

  test("native button binds the label, one press action and accessible hit geometry", () => {
    expect(controlMin).toBe(44);
    expect(component).toContain('testID="quick-scroll-button"');
    expect(component).toContain('accessibilityRole="button"');
    expect(component).toContain("accessibilityLabel={quickScrollLabel(direction, badge)}");
    expect(component).toContain("onPress={onPress}");
    expect(component).toContain("style={styles.hit}");
    expect(component).toContain("width: controlMin");
    expect(component).toContain("height: controlMin");
    expect(component).toContain("width: 40");
    expect(component).toContain("height: 40");
    expect(component).toContain("quickScrollBadge(badge)");
    expect(component).toContain("importantForAccessibility=");
  });

  test("entrance fades and scales with timing tokens and system reduced motion", () => {
    expect(component).toContain("ZoomIn.duration(timing.state).reduceMotion(ReduceMotion.System)");
    expect(component).toContain("entering={enter}");
    expect(component).toContain("scaleTo={PRESS_SCALE.control}");
  });
});
