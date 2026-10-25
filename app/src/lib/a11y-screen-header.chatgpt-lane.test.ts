import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { headerButtonModel, invokeHeaderButton } from "./a11y-screen-header";

const headerSource = readFileSync(new URL("../components/ScreenHeader.tsx", import.meta.url), "utf8");
const pressScaleSource = readFileSync(new URL("../components/PressScale.tsx", import.meta.url), "utf8");

describe("ScreenHeader icon button semantics", () => {
  test("named available buttons are actionable without invented busy/selected/expanded state", () => {
    expect(headerButtonModel("  Settings  ", true)).toEqual({
      label: "Settings",
      disabled: false,
      accessibilityState: { disabled: false },
    });
    expect(headerButtonModel("Back", true)).toEqual({
      label: "Back",
      disabled: false,
      accessibilityState: { disabled: false },
    });
  });

  test("disabled and busy controls cannot activate; false state remains explicitly false", () => {
    expect(headerButtonModel("Save", true, { disabled: true })).toEqual({
      label: "Save",
      disabled: true,
      accessibilityState: { disabled: true },
    });
    expect(headerButtonModel("Refresh", true, { busy: true })).toEqual({
      label: "Refresh",
      disabled: true,
      accessibilityState: { disabled: true, busy: true },
    });
    expect(headerButtonModel("Refresh", true, { disabled: false, busy: false })).toEqual({
      label: "Refresh",
      disabled: false,
      accessibilityState: { disabled: false, busy: false },
    });
  });

  test("selected and expanded are reported only when actually provided", () => {
    expect(headerButtonModel("Options", true, { selected: true, expanded: true })).toEqual({
      label: "Options",
      disabled: false,
      accessibilityState: { disabled: false, selected: true, expanded: true },
    });
    expect(headerButtonModel("Options", true, { selected: false, expanded: false })).toEqual({
      label: "Options",
      disabled: false,
      accessibilityState: { disabled: false, selected: false, expanded: false },
    });
  });

  test("missing callbacks or accessible names stay unavailable", () => {
    expect(headerButtonModel("Settings", false)).toEqual({
      label: "Settings",
      disabled: true,
      accessibilityState: { disabled: true },
    });
    expect(headerButtonModel("  ", true)).toEqual({
      label: "Unavailable action",
      disabled: true,
      accessibilityState: { disabled: true },
    });
    expect(headerButtonModel("", false, { busy: true })).toEqual({
      label: "Unavailable action",
      disabled: true,
      accessibilityState: { disabled: true, busy: true },
    });
  });

  test("touch and accessibility click use the same guarded onPress callback", () => {
    const events: string[] = [];
    const onPress = () => { events.push("action"); };
    const feedback = () => { events.push("haptic"); };
    const model = headerButtonModel("Back", true);
    expect(invokeHeaderButton(model, onPress, feedback)).toBe(true);
    expect(invokeHeaderButton(model, onPress, feedback)).toBe(true);
    expect(events).toEqual(["haptic", "action", "haptic", "action"]);
    expect(invokeHeaderButton(headerButtonModel("Back", true, { disabled: true }), onPress, feedback)).toBe(false);
    expect(invokeHeaderButton(headerButtonModel("Back", true, { busy: true }), onPress, feedback)).toBe(false);
    expect(invokeHeaderButton(headerButtonModel("Back", false), undefined, feedback)).toBe(false);
    expect(events).toHaveLength(4);
  });
});

describe("ScreenHeader component accessibility wiring (source contract, not a native render)", () => {
  test("title is announced as a heading by its complete name even when visually truncated", () => {
    expect(headerSource).toContain('accessibilityRole="header"');
    expect(headerSource).toContain("accessible={hasTitle}");
    expect(headerSource).toContain("accessibilityLabel={hasTitle ? title : undefined}");
    expect(headerSource).toContain("allowFontScaling");
    expect(headerSource).toContain("numberOfLines={1}");
  });

  test("Back and optional action remain named buttons with state and guarded actions", () => {
    expect(headerSource).toContain('accessibilityRole="button"');
    expect(headerSource).toContain("accessibilityLabel={model.label}");
    expect(headerSource).toContain("accessibilityState={model.accessibilityState}");
    expect(headerSource).toContain("disabled={model.disabled}");
    expect(headerSource).toContain("invokeHeaderButton(model, onPress, () => haptic.select())");
    expect(headerSource).toContain('<IconButton icon="arrow-left" label="Back" onPress={onBack} state={backState} />');
    expect(headerSource).toContain("label={actionLabel} onPress={onAction} state={actionState}");
    expect(headerSource).not.toContain("onAccessibilityAction");
    expect(pressScaleSource).toContain("onPress={e => { if (!swiping?.value) onPress?.(e); }}");
  });

  test("no unlabeled action or focusable placeholder when onAction is absent", () => {
    expect(headerSource).toContain('const hasAction = typeof onAction === "function" && actionLabel.length > 0;');
    expect(headerSource).toContain('importantForAccessibility="no-hide-descendants" style={styles.hit}');
    expect(headerSource).toContain("accessibilityElementsHidden");
  });

  test("keeps 44-DIP targets, fixed 60-DIP row, existing glass styling and reduced-motion press", () => {
    expect(headerSource).toMatch(/hit:\s*\{\s*width:\s*44,\s*height:\s*44/);
    expect(headerSource).toMatch(/row:\s*\{[^}]*height:\s*60/);
    expect(headerSource).toContain("backgroundColor: glass.fill");
    expect(pressScaleSource).toContain("reduceMotion: ReduceMotion.System");
  });
});
