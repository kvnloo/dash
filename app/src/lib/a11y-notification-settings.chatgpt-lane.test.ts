import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { notificationToggleAccessibility } from "./a11y-notification-settings";

const component = readFileSync(new URL("../components/NotificationSettings.tsx", import.meta.url), "utf8");

describe("NotificationSettings accessibility state", () => {
  const variants = [
    {
      name: "granted and enabled is a checked switch with a disable action",
      state: { available: true, enabled: true, permission: "granted" },
      expected: {
        visible: true, disabled: false, checked: true,
        actionLabel: "Disable notifications",
        label: "Notifications on. Android permission: granted.",
        hint: "Double tap to disable notifications.",
        permissionLabel: "Android permission: granted",
      },
    },
    {
      name: "granted but disabled is unchecked with an enable action",
      state: { available: true, enabled: false, permission: "granted" },
      expected: {
        visible: true, disabled: false, checked: false,
        actionLabel: "Enable notifications",
        label: "Notifications off. Android permission: granted.",
        hint: "Double tap to enable notifications.",
        permissionLabel: "Android permission: granted",
      },
    },
    {
      name: "denied OS permission overrides an enabled preference",
      state: { available: true, enabled: true, permission: "denied" },
      expected: {
        visible: true, disabled: false, checked: false,
        actionLabel: "Enable notifications",
        label: "Notifications off. Android permission: denied.",
        hint: "Double tap to enable notifications.",
        permissionLabel: "Android permission: denied",
      },
    },
    {
      name: "undetermined OS permission is not announced as enabled",
      state: { available: true, enabled: true, permission: "undetermined" },
      expected: {
        visible: true, disabled: false, checked: false,
        actionLabel: "Enable notifications",
        label: "Notifications off. Android permission: undetermined.",
        hint: "Double tap to enable notifications.",
        permissionLabel: "Android permission: undetermined",
      },
    },
    {
      name: "unavailable permission disables rather than offering a broken toggle",
      state: { available: true, enabled: true, permission: "unavailable" },
      expected: {
        visible: true, disabled: true, checked: false,
        actionLabel: "Notifications unavailable",
        label: "Notifications unavailable. Android permission: unavailable.",
        hint: "Notification controls are unavailable.",
        permissionLabel: "Android permission: unavailable",
      },
    },
    {
      name: "missing permission is unknown, never silently granted",
      state: { available: true, enabled: true, permission: "  " },
      expected: {
        visible: true, disabled: true, checked: false,
        actionLabel: "Notifications unavailable",
        label: "Notifications unavailable. Android permission: unknown.",
        hint: "Notification controls are unavailable.",
        permissionLabel: "Android permission: unknown",
      },
    },
  ];

  for (const variant of variants) {
    test(variant.name, () => {
      expect(notificationToggleAccessibility(variant.state)).toEqual(variant.expected);
    });
  }

  test("an unavailable native build cannot expose or check the switch", () => {
    const result = notificationToggleAccessibility({ available: false, enabled: true, permission: "granted" });
    expect(result.visible).toBe(false);
    expect(result.disabled).toBe(true);
    expect(result.checked).toBe(false);
    expect(component).toContain("{a11y.visible ? <>");
    expect(component).toContain("Notifications and incoming Android shares require the installed Dash build.");
  });
});

describe("NotificationSettings mounted semantics (source-level checks)", () => {
  test("the same checked state drives TalkBack role/state, visible action, and touch callback", () => {
    expect(component).toContain("const a11y = notificationToggleAccessibility(state)");
    expect(component).toContain('accessibilityRole="switch"');
    expect(component).toContain("accessibilityLabel={a11y.label}");
    expect(component).toContain("accessibilityHint={a11y.hint}");
    expect(component).toContain("accessibilityState={{ checked: a11y.checked, disabled: a11y.disabled }}");
    expect(component).toContain("disabled={a11y.disabled}");
    expect(component).toContain("{a11y.actionLabel}");
    expect(component).toContain("onPress={() => void (a11y.checked ? disableNativeNotifications() : enableNativeNotifications())}");
    expect(component).toContain("color: a11y.disabled ? colors.textMuted : colors.gold");
  });

  test("Android system-settings navigation stays keyboard/TalkBack actionable", () => {
    expect(component).toContain('accessibilityRole="button"');
    expect(component).toContain('accessibilityLabel="Open Dash app settings in Android"');
    expect(component).toContain('accessibilityHint="Review notification permissions in Android settings."');
    expect(component).toContain("onPress={() => void Linking.openSettings()}");
    expect(component.match(/minHeight: 48/g)).toHaveLength(2);
  });

  test("permissions update audibly and error details remain alert-announced", () => {
    expect(component).toContain('accessibilityLiveRegion="polite"');
    expect(component).toContain("{a11y.permissionLabel}");
    expect(component).toContain('accessibilityRole="alert"');
    expect(component).toContain('accessibilityLiveRegion="assertive"');
    expect(component).toContain('accessibilityLabel={`Notification error: ${state.error}`}');
    expect(component).toContain("{state.error}");
  });
});
