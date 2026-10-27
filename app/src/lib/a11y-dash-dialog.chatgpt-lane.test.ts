import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  dialogButtonLayout,
  dialogButtonOrder,
  dialogFirstFocusButtonId,
  dialogModalA11y,
  dialogTitleRole,
  dismissResult,
  type DashDialogButton,
} from "./a11y-dash-dialog";

const hostSource = readFileSync(join(import.meta.dir, "../components/DashDialogHost.tsx"), "utf8");
const cancel: DashDialogButton = { id: "cancel", label: "Cancel", role: "cancel" };
const save: DashDialogButton = { id: "save", label: "Save", role: "default" };
const remove: DashDialogButton = { id: "remove", label: "Delete", role: "destructive" };

describe("Dash dialog button geometry", () => {
  test("two short actions share one row with enough DIP width", () => {
    expect(dialogButtonLayout([cancel, save], 300)).toBe("row");
    expect(dialogButtonLayout([save, cancel], 264)).toBe("row");
  });

  test("three actions or a long label stack, even on a wide phone", () => {
    expect(dialogButtonLayout([cancel, save, remove], 420)).toBe("column");
    expect(dialogButtonLayout([
      cancel,
      { id: "rename", label: "Rename and archive this workspace", role: "default" },
    ], 300)).toBe("column");
  });

  test("narrow, non-finite, or invalid widths never force unreadable rows", () => {
    expect(dialogButtonLayout([cancel, save], 120)).toBe("column");
    expect(dialogButtonLayout([cancel, save], Number.NaN)).toBe("column");
    expect(dialogButtonLayout([cancel, save], Number.POSITIVE_INFINITY)).toBe("column");
    expect(dialogButtonLayout([save], 320)).toBe("column");
  });

  test("cancel moves to the left without changing the original action array", () => {
    const input = [remove, save, cancel];
    expect(dialogButtonOrder(input).map((button) => button.id)).toEqual(["cancel", "remove", "save"]);
    expect(input.map((button) => button.id)).toEqual(["remove", "save", "cancel"]);
  });
});

describe("Dash dialog focus and dismissal", () => {
  test("a destructive dialog focuses the cancel action even when delete comes first", () => {
    expect(dialogFirstFocusButtonId([remove, cancel])).toBe("cancel");
    expect(dialogFirstFocusButtonId([cancel, remove])).toBe("cancel");
  });

  test("if destructive has no cancel, focus another safe action if available", () => {
    expect(dialogFirstFocusButtonId([remove, save])).toBe("save");
    expect(dialogFirstFocusButtonId([remove])).toBe("remove");
    expect(dialogFirstFocusButtonId([])).toBeNull();
  });

  test("non-destructive dialogs focus the first supplied action", () => {
    expect(dialogFirstFocusButtonId([save, cancel])).toBe("save");
  });

  test("Back and accessibility escape use the exact cancel id or null", () => {
    expect(dismissResult([remove, cancel])).toBe("cancel");
    expect(dismissResult([save])).toBeNull();
    expect(dismissResult([])).toBeNull();
  });

  test("the backdrop can only cancel when a real cancel action exists", () => {
    expect(dismissResult([save, cancel])).not.toBeNull();
    expect(dismissResult([remove])).toBeNull();
    expect(hostSource).toContain("if (dismissId !== null) resolve(dismissId)");
    expect(hostSource).toContain("onPress={handleBackdrop}");
    expect(hostSource).toContain("onRequestClose={handleBack}");
    expect(hostSource).toContain("onAccessibilityEscape={handleBack}");
  });
});

describe("Dash dialog native accessibility wiring", () => {
  test("the modal traps accessibility, and title is exposed as a header", () => {
    expect(dialogModalA11y.accessibilityViewIsModal).toBe(true);
    expect(dialogTitleRole).toBe("header");
    expect(hostSource).toContain("{...dialogModalA11y}");
    expect(hostSource).toContain("accessibilityRole={dialogTitleRole}");
    expect(hostSource).toContain("accessibilityElementsHidden");
    expect(hostSource).toContain('importantForAccessibility="no-hide-descendants"');
  });

  test("first button gets native accessibility focus on show and request advancement", () => {
    expect(hostSource).toContain("dialogFirstFocusButtonId(request.buttons)");
    expect(hostSource).toContain("AccessibilityInfo.setAccessibilityFocus(node)");
    expect(hostSource).toContain("onShow={focusFirstButton}");
    expect(hostSource).toContain("requestAnimationFrame(focusFirstButton)");
  });

  test("all actions retain scalable labels and 44 DIP minimum, without system Alerts", () => {
    expect(hostSource).toContain('accessibilityRole="button"');
    expect(hostSource).toContain("accessibilityLabel={button.label}");
    expect(hostSource).toContain("allowFontScaling");
    expect(hostSource).toMatch(/minHeight:\s*44/);
    expect(hostSource).toMatch(/minWidth:\s*44/);
    expect(hostSource).toContain('animationType={reducedMotion ? "none" : "fade"}');
    expect(hostSource).toContain("colors.danger");
    expect(hostSource).toContain("colors.gold");
    expect(hostSource).not.toMatch(/Alert\.alert\s*\(/);
  });

  test("a double tap cannot resolve the next queued dialog accidentally", () => {
    expect(hostSource).toContain("resolvedRequestRef.current === request");
    expect(hostSource).toContain("resolvedRequestRef.current = request");
  });
});
