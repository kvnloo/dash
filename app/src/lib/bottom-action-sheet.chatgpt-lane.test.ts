import { describe, expect, test, mock } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SHEET_HEADER_HEIGHT, SHEET_ROW_HEIGHT, createSheetInteraction, selectAndClose, sheetA11y, sheetLayout,
  type BottomActionOption, type SheetSelection,
} from "./bottom-action-sheet";

const actions: BottomActionOption[] = [
  { id: "open", label: "Open", accessibilityLabel: "Open chat", destructive: false },
  { id: "pin", label: "Pin", accessibilityLabel: "Pin chat", destructive: false },
  { id: "archive", label: "Archive", accessibilityLabel: "Archive chat", destructive: false },
  { id: "delete", label: "Delete", accessibilityLabel: "Delete", destructive: true },
];

describe("bottom action sheet layout", () => {
  test("fits a few actions plus header and safe area without scrolling", () => {
    expect(sheetLayout(3, 900, 24)).toEqual({
      height: SHEET_HEADER_HEIGHT + 3 * SHEET_ROW_HEIGHT + 24,
      scrollable: false,
    });
    expect(sheetLayout(0, 900, 0)).toEqual({ height: SHEET_HEADER_HEIGHT, scrollable: false });
  });

  test("caps numerous rows at 60% of window and scrolls the option list", () => {
    const layout = sheetLayout(30, 800, 24);
    expect(layout).toEqual({ height: 480, scrollable: true });
    expect(layout.height).toBeLessThanOrEqual(800 * 0.6);
  });

  test("even a tiny window stays capped and requests scrolling", () => {
    expect(sheetLayout(4, 100, 20)).toEqual({ height: 60, scrollable: true });
    expect(sheetLayout(3, 0, 20)).toEqual({ height: 0, scrollable: true });
    expect(sheetLayout(-4, 900, -10)).toEqual({ height: SHEET_HEADER_HEIGHT, scrollable: false });
  });

  test("sanitizes non-finite dimensions and fractional counts", () => {
    expect(sheetLayout(Number.NaN, Number.NaN, Number.POSITIVE_INFINITY))
      .toEqual({ height: 0, scrollable: true });
    expect(sheetLayout(2.9, 1000, 0)).toEqual({
      height: SHEET_HEADER_HEIGHT + 2 * SHEET_ROW_HEIGHT,
      scrollable: false,
    });
  });
});

describe("bottom action sheet accessibility", () => {
  test("announces labels with stable one-based positions", () => {
    const rows = sheetA11y(actions);
    expect(rows.map(row => row.accessibilityLabel)).toEqual([
      "Open chat, 1 of 4",
      "Pin chat, 2 of 4",
      "Archive chat, 3 of 4",
      "Delete, 4 of 4",
    ]);
    expect(rows.map(row => row.position)).toEqual([1, 2, 3, 4]);
    expect(rows.every(row => row.total === 4)).toBe(true);
    expect(rows[0]?.label).toBe("Open");
  });

  test("marks destructive actions without turning normal rows destructive", () => {
    const rows = sheetA11y(actions);
    expect(rows[3]?.destructive).toBe(true);
    expect(rows[3]?.accessibilityHint).toBe("Destructive action");
    expect(rows[0]?.accessibilityHint).toBeUndefined();
    expect(rows[0]?.destructive).toBe(false);
    expect(sheetA11y([])).toEqual([]);
  });

  test("falls back to the visible label for empty screen-reader copy", () => {
    expect(sheetA11y([{ id: "a", label: "Settings", accessibilityLabel: " ", destructive: false }])[0]?.accessibilityLabel)
      .toBe("Settings, 1 of 1");
  });
});

describe("bottom action sheet one-shot selection", () => {
  test("a valid selection consumes the open state and cannot close twice", () => {
    let state: SheetSelection = { open: true, selectedId: null };
    const events: string[] = [];
    const dispatch = (id: string) => {
      const next = selectAndClose(state, id, actions);
      if (next === state) return;
      state = next;
      events.push(`selected:${id}`, "closed");
    };
    dispatch("archive");
    dispatch("delete");
    dispatch("archive");
    expect(state).toEqual({ open: false, selectedId: "archive" });
    expect(events).toEqual(["selected:archive", "closed"]);
  });

  test("a missing id or a dismissed sheet is a no-op", () => {
    const open: SheetSelection = { open: true, selectedId: null };
    const closed: SheetSelection = { open: false, selectedId: null };
    expect(selectAndClose(open, "unknown", actions)).toBe(open);
    expect(selectAndClose(closed, "delete", actions)).toBe(closed);
  });
});

describe("bottom sheet interaction lifecycle", () => {
  test("iOS retains the selecting chat callback after close clears the host context", () => {
    const interaction = createSheetInteraction(true);
    const events: string[] = [];
    let selectedChat: string | null = "chat-a";
    const chatAtSelection = selectedChat;
    const onSelect = (id: string) => events.push(`${chatAtSelection}:${id}`);
    const close = () => { selectedChat = null; events.push("closed"); };
    interaction.choose("delete", actions, onSelect, close, true);
    interaction.choose("open", actions, onSelect, close, true);
    interaction.dismiss(close);
    interaction.setOpen(false);
    expect(selectedChat).toBeNull();
    expect(events).toEqual(["closed"]);
    interaction.didDismiss();
    interaction.didDismiss();
    expect(events).toEqual(["closed", "chat-a:delete"]);
  });

  test("immediate selection closes even when its callback throws", () => {
    const interaction = createSheetInteraction(true);
    let closed = 0;
    expect(() => interaction.choose("open", actions, () => { throw new Error("action failed"); },
      () => { closed++; }, false)).toThrow("action failed");
    interaction.dismiss(() => { closed++; });
    expect(closed).toBe(1);
  });

  test("dismissal never selects and reopening permits a fresh choice", () => {
    const interaction = createSheetInteraction(true);
    const events: string[] = [];
    const close = () => events.push("closed");
    const select = (id: string) => events.push(id);
    interaction.choose("missing", actions, select, close, false);
    interaction.dismiss(close);
    interaction.dismiss(close);
    interaction.didDismiss();
    interaction.setOpen(true);
    interaction.choose("open", actions, select, close, false);
    expect(events).toEqual(["closed", "open", "closed"]);
  });
});

// Render real React with native primitives replaced, not source-text assertions.
// Native layout, animations and device accessibility still need integration gates.
interface NativeProps {
  children?: ReactNode;
  testID?: string;
  style?: unknown;
  scrollEnabled?: boolean;
  onPress?: () => void;
  onRequestClose?: () => void;
  onDismiss?: () => void;
}
const rendered: { kind: string; props: NativeProps; markup: string }[] = [];
function primitive(kind: string) {
  return (props: NativeProps) => {
    const markup = renderToStaticMarkup(createElement("div", null, props.children));
    rendered.push({ kind, props, markup });
    return createElement("div", null, props.children);
  };
}
mock.module("react-native", () => ({
  AccessibilityInfo: { setAccessibilityFocus() {} },
  Modal: primitive("Modal"), Platform: { OS: "ios" }, Pressable: primitive("Pressable"),
  ScrollView: primitive("ScrollView"), Text: primitive("Text"), View: primitive("View"),
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  findNodeHandle: () => null, useWindowDimensions: () => ({ height: 100, width: 400 }),
}));
mock.module("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 20 }) }));
mock.module("@expo/vector-icons", () => ({ Feather: () => null }));
mock.module("../components/GlassSurface", () => ({ GlassSurface: primitive("GlassSurface") }));
mock.module("react-native-reanimated", () => ({
  default: { View: primitive("AnimatedView") }, Easing: { bezier: () => () => 0 },
  ReduceMotion: { System: "system" }, useAnimatedStyle: (style: () => unknown) => style(),
  useReducedMotion: () => true, useSharedValue: (value: number) => ({ value }),
  withTiming: (value: number) => value,
}));
const { BottomActionSheet } = await import("../components/BottomActionSheet");

test("rendered tiny sheet scrolls header, rows and inset together and dispatches real events once", () => {
  rendered.length = 0;
  const events: string[] = [];
  renderToStaticMarkup(createElement(BottomActionSheet, {
    open: true, title: "Chat actions", options: actions,
    onSelect: id => { events.push(id); }, onClose: () => { events.push("closed"); },
  }));
  const scroll = rendered.find(node => node.kind === "ScrollView");
  expect(scroll?.props.scrollEnabled).toBe(true);
  expect(scroll?.markup).toContain("Chat actions");
  expect(scroll?.markup).toContain("Delete");
  const sheet = rendered.find(node => node.kind === "GlassSurface");
  // No fixed header/footer siblings can consume the tiny 60-DIP viewport.
  expect(sheet?.markup).toBe(`<div>${scroll?.markup}</div>`);
  const backdrop = rendered.find(node => node.props.testID === "bottom-action-sheet-backdrop");
  expect(backdrop?.props.style).toMatchObject({ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 });
  const option = rendered.find(node => node.props.testID === "bottom-action-sheet-option-delete");
  const modal = rendered.find(node => node.kind === "Modal");
  option?.props.onPress?.();
  option?.props.onPress?.();
  backdrop?.props.onPress?.();
  modal?.props.onRequestClose?.();
  expect(events).toEqual(["closed"]);
  modal?.props.onDismiss?.();
  modal?.props.onDismiss?.();
  expect(events).toEqual(["closed", "delete"]);
});
