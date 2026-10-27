import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SHEET_HEADER_HEIGHT, SHEET_ROW_HEIGHT, selectAndClose, sheetA11y, sheetLayout,
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

describe("bottom sheet native component wiring contract", () => {
  const component = readFileSync(join(import.meta.dir, "../components/BottomActionSheet.tsx"), "utf8");

  test("covers backdrop, Android Back, accessible close control and themed destructive rows", () => {
    expect(component).toContain('onRequestClose={dismiss}');
    expect(component).toContain('onPress={dismiss}');
    expect(component).toContain('accessibilityLabel="Close actions"');
    expect(component).toContain('accessibilityLabel={row.accessibilityLabel}');
    expect(component).toContain('accessibilityHint={row.accessibilityHint}');
    expect(component).toContain("row.destructive && styles.destructive");
    expect(component).toContain("color: colors.danger");
    expect(component).toContain("height: SHEET_ROW_HEIGHT");
  });

  test("uses the tokenized slide and bypasses slide for reduced motion", () => {
    expect(component).toContain('animationType="none"');
    expect(component).toContain("Easing.bezier(...easing.sheet)");
    expect(component).toContain("duration: timing.state");
    expect(component).toContain("reducedMotion ? 0");
    expect(component).toContain("selectAndClose(previous, id, options)");
    expect(component).toContain("pendingIosSelection.current = id");
    expect(component).toContain("onDismiss={flushPendingSelection}");
  });
});
