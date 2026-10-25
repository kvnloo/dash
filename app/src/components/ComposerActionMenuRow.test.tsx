import { describe, expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComposerMenuRowShape } from "../lib/composer-row-submenu";

// Render the real row JSX on Bun without a native device or new test dependency.
// Captured recognizers let the test dispatch the Pan and Tap winners separately.
type NativeProps = {
  children?: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
  accessibilityState?: { expanded?: boolean; selected?: boolean };
};
const host = (tag: "div" | "span" | "button") =>
  ({ children, accessibilityLabel, testID, accessibilityState }: NativeProps) =>
    createElement(tag, {
      "aria-label": accessibilityLabel,
      "data-testid": testID,
      "aria-expanded": accessibilityState?.expanded,
      "aria-selected": accessibilityState?.selected,
    }, children);

mock.module("react-native", () => ({
  View: host("div"),
  Text: host("span"),
  Pressable: host("button"),
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  BackHandler: { addEventListener: () => ({ remove() {} }) },
}));
mock.module("react-native-reanimated", () => ({
  default: { View: host("div") },
  useSharedValue: <T,>(value: T) => ({ value }),
  runOnJS: <Args extends unknown[], Result>(callback: (...args: Args) => Result) => callback,
}));
mock.module("../haptics", () => ({ haptic: { select() {} } }));
mock.module("../theme", () => ({
  colors: { bg: "#000000", text: "#f2f2f2", textMuted: "#8b8b8b" },
  glass: { hair: "#262626", fillChipOn: "#191919" },
  radius: { md: 16 },
  type: { small: {}, mono: {} },
}));

type Touch = { y: number };
class FakeGesture {
  start?: () => void;
  update?: (event: Touch) => void;
  end?: (event: Touch, success: boolean) => void;
  constructor(readonly kind: "pan" | "tap") {}
  activateAfterLongPress(_delay: number) { return this; }
  shouldCancelWhenOutside(_cancel: boolean) { return this; }
  maxDuration(_duration: number) { return this; }
  onStart(handler: () => void) { this.start = handler; return this; }
  onUpdate(handler: (event: Touch) => void) { this.update = handler; return this; }
  onEnd(handler: (event: Touch, success: boolean) => void) { this.end = handler; return this; }
  onFinalize(_handler: () => void) { return this; }
}
let gestureWinners: FakeGesture[] = [];
mock.module("react-native-gesture-handler", () => ({
  Gesture: {
    Pan: () => new FakeGesture("pan"),
    Tap: () => new FakeGesture("tap"),
    Exclusive: (...items: FakeGesture[]) => { gestureWinners = items; return items; },
  },
  GestureDetector: ({ children }: { children: ReactNode }) => children,
}));

// Import only after the native mocks are registered.
const { ComposerActionMenuRow } = await import("./ComposerActionMenuRow");

describe("rendered ComposerActionMenuRow gesture contract", () => {
  test("holding an exact row reveals its own anchored options; sliding down and releasing selects", () => {
    const calls: string[] = [];
    let expanded = false;
    const row: ComposerMenuRowShape = {
      id: "surface", label: "Surface", value: "Chat",
      values: ["Chat", "Live surface"], index: 0,
      run: () => calls.push("primary"),
      inspect: index => calls.push("inspect:" + index),
    };
    const render = () => renderToStaticMarkup(createElement(ComposerActionMenuRow, {
      row, side: "left", expanded, highlighted: false,
      onOpenSubmenu: () => { expanded = true; },
      onDismissSubmenu: () => { expanded = false; },
      onCloseMenu: () => { expanded = false; calls.push("close"); },
    }));

    expect(render()).toContain('data-testid="composer-menu-row-surface"');
    expect(render()).not.toContain("composer-menu-submenu-surface");
    const hold = gestureWinners.find(gesture => gesture.kind === "pan");
    hold?.start?.();
    expect(expanded).toBe(true);
    expect(calls).toEqual([]); // Holding never invokes the tapped row.
    const opened = render();
    expect(opened).toContain('data-testid="composer-menu-submenu-surface"');
    expect(opened).toContain('aria-label="Surface options"');
    expect(opened).toContain('data-testid="composer-menu-choice-surface-1"');
    expect(opened).toContain("Live surface");

    const drag = gestureWinners.find(gesture => gesture.kind === "pan");
    drag?.start?.();
    drag?.update?.({ y: 97 }); // Dropdown is directly below the 48-DIP row.
    drag?.end?.({ y: 97 }, true);
    expect(calls).toEqual(["close", "inspect:1"]);
    expect(expanded).toBe(false);
  });

  test("the exclusive Tap recognizer still runs the row's existing action once", () => {
    const calls: string[] = [];
    const row: ComposerMenuRowShape = {
      id: "approvals", label: "Approvals", value: "2 pending",
      run: () => calls.push("approvals"),
    };
    renderToStaticMarkup(createElement(ComposerActionMenuRow, {
      row, side: "right", expanded: false, highlighted: false,
      onOpenSubmenu: () => calls.push("held"),
      onDismissSubmenu: () => calls.push("dismissed"),
      onCloseMenu: () => calls.push("closed"),
    }));
    const tap = gestureWinners.find(gesture => gesture.kind === "tap");
    tap?.end?.({ y: 20 }, true);
    expect(calls).toEqual(["closed", "approvals"]);
    tap?.end?.({ y: 20 }, false);
    expect(calls).toEqual(["closed", "approvals"]); // A failed tap does nothing.
  });

  test("after lifting, the rendered popup offers action-only rows without fake modes", () => {
    const row: ComposerMenuRowShape = {
      id: "annotate", label: "Annotate", value: "S Pen or finger",
      run() {},
    };
    const html = renderToStaticMarkup(createElement(ComposerActionMenuRow, {
      row, side: "left", expanded: true, highlighted: false,
      onOpenSubmenu() {}, onDismissSubmenu() {}, onCloseMenu() {},
    }));
    expect(html).toContain('data-testid="composer-menu-submenu-annotate"');
    expect(html).toContain("Open Annotate");
    expect(html).not.toContain("Eraser");
    expect(html).toContain('aria-expanded="true"');
  });
});
