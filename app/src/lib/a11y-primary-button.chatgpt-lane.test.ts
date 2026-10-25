import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { primaryButtonA11y } from "./a11y-primary-button";

const component = readFileSync(
  join(import.meta.dir, "../components/PrimaryButton.tsx"),
  "utf8",
);

describe("PrimaryButton accessibility", () => {
  test("defaults to an enabled, named button without inventing selected/expanded state", () => {
    expect(primaryButtonA11y({ label: "Connect" })).toEqual({
      accessibilityLabel: "Connect",
      accessibilityRole: "button",
      accessibilityState: { busy: false, disabled: false },
      disabled: false,
    });
  });

  test("preserves the exact caller label and role, including an intentional empty label", () => {
    const named = primaryButtonA11y({
      label: "Continue",
      accessibilityLabel: "Continue to pairing",
      accessibilityRole: "link",
    });
    expect(named.accessibilityLabel).toBe("Continue to pairing");
    expect(named.accessibilityRole).toBe("link");
    expect(primaryButtonA11y({ label: "Continue", accessibilityLabel: "" }).accessibilityLabel).toBe("");
    expect(primaryButtonA11y({ label: "" }).accessibilityLabel).toBe("");
  });

  test("both a disabled press target and a declared disabled state prevent activation", () => {
    for (const input of [
      { label: "Send", disabled: true, accessibilityState: { disabled: false } },
      { label: "Send", disabled: false, accessibilityState: { disabled: true } },
    ]) {
      const resolved = primaryButtonA11y(input);
      expect(resolved.disabled).toBe(true);
      expect(resolved.accessibilityState.disabled).toBe(true);
      expect(resolved.accessibilityState.busy).toBe(false);
    }
  });

  test("loading or caller-declared busy blocks repeated press and reports busy", () => {
    const loading = primaryButtonA11y({
      label: "Pairing",
      loading: true,
      accessibilityState: { busy: false, selected: true },
    });
    expect(loading.disabled).toBe(true);
    expect(loading.accessibilityState).toEqual({
      busy: true,
      disabled: true,
      selected: true,
    });

    const busy = primaryButtonA11y({
      label: "Pairing",
      accessibilityState: { busy: true },
    });
    expect(busy.disabled).toBe(true);
    expect(busy.accessibilityState.busy).toBe(true);
    expect(primaryButtonA11y({ label: "Pairing", loading: false }).disabled).toBe(false);
  });

  test("preserves caller-selected, expanded and checked values without guessing them", () => {
    const selected = primaryButtonA11y({
      label: "Details",
      accessibilityState: { selected: true, expanded: false, checked: "mixed" },
    });
    expect(selected.accessibilityState).toEqual({
      selected: true,
      expanded: false,
      checked: "mixed",
      busy: false,
      disabled: false,
    });
    const expanded = primaryButtonA11y({
      label: "Details",
      accessibilityState: { selected: false, expanded: true },
    });
    expect(expanded.accessibilityState.selected).toBe(false);
    expect(expanded.accessibilityState.expanded).toBe(true);
  });

  test("uses the same native Pressable activation target for touch and accessibility", () => {
    expect(component).toMatch(/<Pressable\s+\{\.\.\.rest\}/);
    expect(component).toContain("disabled={a11y.disabled}");
    expect(component).toContain("accessibilityLabel={a11y.accessibilityLabel}");
    expect(component).toContain("accessibilityRole={a11y.accessibilityRole}");
    expect(component).toContain("accessibilityState={a11y.accessibilityState}");
    // RN Pressable maps its default accessibility activate action to onPress.
    // Keeping both event props in ...rest avoids a competing or duplicated handler.
    expect(component).not.toMatch(/\sonPress=/);
    expect(component).not.toMatch(/\sonAccessibilityAction=/);
    expect(component).not.toMatch(/\saccessibilityActions=/);
    expect(component).not.toMatch(/\sfocusable=/);
  });

  test("retains caller static/dynamic styles, a 44 DIP floor and scalable text", () => {
    expect(component).toContain('typeof style === "function" ? style(state) : style');
    expect(component).toContain("styles.minTarget");
    expect(component).toMatch(/minHeight:\s*44/);
    expect(component).toMatch(/minWidth:\s*44/);
    expect(component).toContain("allowFontScaling");
    expect(component).not.toContain("numberOfLines");
    expect(component).not.toContain("withTiming");
  });
});
