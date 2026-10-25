import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  settingsConnectA11y,
  settingsHarnessA11y,
  settingsModelsA11y,
  settingsThumbA11y,
  type SettingsConnectA11yInput,
} from "./a11y-settings-screen";

const source = readFileSync(new URL("../screens/SettingsScreen.tsx", import.meta.url), "utf8");

const ready: SettingsConnectA11yInput = {
  firstRun: false,
  dirty: false,
  saving: false,
  canSave: true,
  hasAddress: true,
  hasCredential: true,
};

function connection(overrides: Partial<SettingsConnectA11yInput> = {}) {
  return settingsConnectA11y({ ...ready, ...overrides });
}

/** Source-level contract only; TalkBack focus and native press behavior still need device checks. */
function pressableWithLabel(label: string): string {
  const labelProp = 'accessibilityLabel="' + label + '"';
  const labelIndex = source.indexOf(labelProp);
  if (labelIndex === -1) throw new Error("Missing accessible action: " + label);
  const start = source.lastIndexOf("<Pressable", labelIndex);
  const end = source.indexOf("</Pressable>", labelIndex);
  if (start === -1 || end === -1) throw new Error("Missing Pressable for: " + label);
  return source.slice(start, end + "</Pressable>".length);
}

describe("Settings connect action", () => {
  test("first-run, reconnect and dirty labels retain their actual operations", () => {
    expect(connection({ firstRun: true })).toEqual({
      label: "Connect",
      accessibilityHint: "Connect to the bridge using these settings",
      accessibilityState: { disabled: false, busy: false },
    });
    expect(connection()).toEqual({
      label: "Reconnect",
      accessibilityHint: "Reconnect to the saved bridge",
      accessibilityState: { disabled: false, busy: false },
    });
    expect(connection({ dirty: true })).toEqual({
      label: "Save and reconnect",
      accessibilityHint: "Save bridge settings and reconnect",
      accessibilityState: { disabled: false, busy: false },
    });
  });

  test("saving and unavailable inputs are disabled with honest reasons", () => {
    expect(connection({ saving: true, canSave: false })).toEqual({
      label: "Connecting…",
      accessibilityHint: "Connection in progress",
      accessibilityState: { disabled: true, busy: true },
    });
    expect(connection({ hasAddress: false, canSave: false }).accessibilityHint).toBe("Enter a bridge address to connect");
    expect(connection({ hasCredential: false, canSave: false }).accessibilityHint).toBe("Enter a token or pair a bridge to connect");
    expect(connection({ canSave: false })).toEqual({
      label: "Reconnect",
      accessibilityHint: "Already connected; change a setting to reconnect",
      accessibilityState: { disabled: true, busy: false },
    });
  });

  test("the actual button shares the same guarded onPress for touch and accessibility", () => {
    expect(source).toContain("const connectA11y = settingsConnectA11y({");
    expect(source).toContain("hasCredential: token.trim().length > 0 || identity !== undefined");
    expect(source).toContain("onPress={() => void save()}");
    expect(source).toContain("disabled={!canSave}");
    expect(source).toContain("label={connectA11y.label}");
    expect(source).toContain("accessibilityLabel={connectA11y.label}");
    expect(source).toContain("accessibilityState={connectA11y.accessibilityState}");
    expect(source).toContain("accessibilityHint={connectA11y.accessibilityHint}");
    expect(source).toContain("if (!canSave) return;");
  });
});

describe("Settings disclosure and display choices", () => {
  test("Models exposes truthful collapsed and expanded states", () => {
    expect(settingsModelsA11y(false)).toEqual({
      accessibilityLabel: "Models",
      accessibilityHint: "Expand model assignments",
      accessibilityState: { expanded: false },
    });
    expect(settingsModelsA11y(true)).toEqual({
      accessibilityLabel: "Models",
      accessibilityHint: "Collapse model assignments",
      accessibilityState: { expanded: true },
    });
    expect(source).toContain("{...settingsModelsA11y(modelsOpen)}");
    expect(source).toContain('accessibilityRole="button"\n            onPress={() => setModelsOpen((open) => !open)}');
    expect(source).toContain("{modelsOpen ? <ModelsPanel /> : null}");
  });

  test("thumb selection announces choice, disabled state and existing preference", () => {
    expect(settingsThumbA11y("right", "right", true)).toEqual({
      accessibilityLabel: "Right thumb side",
      accessibilityHint: "Use the right thumb side",
      accessibilityState: { checked: true, disabled: false },
    });
    expect(settingsThumbA11y("left", "right", true).accessibilityState).toEqual({ checked: false, disabled: false });
    expect(settingsThumbA11y("auto", "auto", true)).toEqual({
      accessibilityLabel: "Automatic thumb side",
      accessibilityHint: "Follow system preference when available, otherwise right",
      accessibilityState: { checked: true, disabled: false },
    });
    expect(settingsThumbA11y("left", "left", false)).toEqual({
      accessibilityLabel: "Left thumb side",
      accessibilityHint: "Pair a bridge to change thumb side",
      accessibilityState: { checked: true, disabled: true },
    });
    expect(source).toContain('accessibilityRole="radio"');
    expect(source).toContain("{...settingsThumbA11y(value, thumb.preference, settings !== null)}");
    expect(source).toContain("disabled={!settings}");
    expect(source).toContain("onPress={() => { setHandedness(value); haptic.select(); }}");
  });

  test("a harness status is spoken together with its name, even without a name", () => {
    expect(settingsHarnessA11y("Hermes", true)).toBe("Hermes, installed");
    expect(settingsHarnessA11y(" OMP ", false)).toBe("OMP, not found");
    expect(settingsHarnessA11y(" ", false)).toBe("Unnamed harness, not found");
    expect(source).toContain("accessibilityLabel={settingsHarnessA11y(h.name, h.available)}");
    expect(source).toContain('accessible\n                      accessibilityRole="text"');
    expect(source).toContain('accessibilityLabel={statusLine.text} accessibilityLiveRegion="polite"');
  });
});

describe("Settings accessible navigation, fields and destructive action", () => {
  test("both pairing actions and other destinations expose the existing target", () => {
    const firstPair = pressableWithLabel("Pair with sonic code instead");
    expect(firstPair).toContain('accessibilityRole="button"');
    expect(firstPair).toContain('onPress={() => navigation.replace("Pair")}');

    const nearbyPair = pressableWithLabel("Pair nearby with sonic code");
    expect(nearbyPair).toContain('accessibilityRole="button"');
    expect(nearbyPair).toContain('onPress={() => navigation.navigate("Pair")}');

    const approvals = pressableWithLabel("Review approvals");
    expect(approvals).toContain('accessibilityRole="button"');
    expect(approvals).toContain('onPress={() => navigation.navigate("Approvals")}');

    const lab = pressableWithLabel("Component lab");
    expect(lab).toContain('accessibilityRole="button"');
    expect(lab).toContain('onPress={() => navigation.navigate("Lab")}');
  });

  test("address, secret token and optional folder retain labeled native inputs", () => {
    for (const label of ["Address", "Token", "Folder"]) {
      expect(source).toContain('label="' + label + '"');
    }
    expect(source).toContain('hint="Required bridge network address"');
    expect(source).toContain('hint="Private bridge execution token"');
    expect(source).toContain('hint="Optional working folder; leave blank for bridge default"');
    expect(source).toContain("accessibilityLabel={label}");
    expect(source).toContain("accessibilityHint={hint}");
    expect(source).toContain("secureTextEntry={secure}");
    expect(source).toContain('linkWrap: { marginBottom: space.md, minHeight: 44');
  });

  test("the feedback switch reflects stored checked state and preserves its toggle", () => {
    const feedback = pressableWithLabel("In-app feedback");
    expect(feedback).toContain('accessibilityRole="switch"');
    expect(feedback).toContain("accessibilityState={{ checked: settings.inAppFeedback }}");
    expect(feedback).toContain("saveSettings({ ...settings, inAppFeedback: !settings.inAppFeedback });");
  });

  test("Forget is unavailable without a saved bridge and requires native confirmation", () => {
    const forget = pressableWithLabel("Forget this bridge");
    expect(source).toContain("{!firstRun && settings ? (");
    expect(forget).toContain('accessibilityRole="button"');
    expect(forget).toContain('accessibilityHint="Opens confirmation before removing the saved bridge and chats"');
    expect(forget).toContain("onPress={forget}");
    expect(source).toContain('confirmDestructive("Forget this bridge?", "Removes the saved address, token, and every chat on this phone.", "Forget", () => {');
    expect(source).toContain('void forgetEverything().then(() => navigation.replace("Settings"));');
  });
});
