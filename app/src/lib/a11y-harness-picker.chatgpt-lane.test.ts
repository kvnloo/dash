import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { activateHarnessPickerRow, harnessPickerRowA11y } from "./a11y-harness-picker";

test("available rows keep their exact selection target, button name and native states", () => {
  const hermes = { id: "hermes", name: "Hermes", available: true };
  expect(harnessPickerRowA11y(hermes, "other")).toEqual({
    id: "hermes",
    name: "Hermes",
    label: "Hermes",
    hint: "Select harness and close picker",
    disabled: false,
    state: { selected: false, disabled: false },
  });
  expect(harnessPickerRowA11y(hermes, "hermes").state).toEqual({
    selected: true,
    disabled: false,
  });
  const opaque = harnessPickerRowA11y({ id: "harness:02 ", name: "  Agent  ", available: true }, "harness:02 ");
  expect(opaque.name).toBe("Agent");
  expect(opaque.id).toBe("harness:02 ");
  expect(opaque.state.selected).toBe(true);
});

test("unavailable rows explicitly announce unavailable without hiding selected state", () => {
  const offline = { id: "codex", name: "Codex", available: false };
  expect(harnessPickerRowA11y(offline, "codex")).toEqual({
    id: "codex",
    name: "Codex",
    label: "Codex, unavailable",
    hint: "Not installed on the bridge machine",
    disabled: true,
    state: { selected: true, disabled: true },
  });
  expect(harnessPickerRowA11y(offline, "hermes").state).toEqual({
    selected: false,
    disabled: true,
  });
});

test("incomplete or malformed bridge data stays honestly unavailable", () => {
  const fixtures = [
    null,
    {},
    { id: "", name: "Agent", available: true },
    { id: "  ", name: "Agent", available: true },
    { id: 7, name: "Agent", available: true },
    { id: "agent", name: "", available: true },
    { id: "agent", name: "  ", available: true },
    { id: "agent", name: "Agent", available: "true" },
  ];
  for (const fixture of fixtures) {
    const row = harnessPickerRowA11y(fixture, "agent");
    expect(row.disabled).toBe(true);
    expect(row.state.disabled).toBe(true);
    expect(row.label).toEndWith(", unavailable");
  }
  expect(harnessPickerRowA11y({ name: "Agent", available: true }, "").hint).toBe("Harness identifier missing");
  expect(harnessPickerRowA11y({ id: "agent", available: true }, "").hint).toBe("Harness name missing");
  expect(harnessPickerRowA11y({}, "").name).toBe("Unknown harness");
});

test("activation uses the same original id and callback order for touch and accessibility", () => {
  const row = harnessPickerRowA11y({ id: "host/hermes", name: "Hermes", available: true }, "other");
  const events: string[] = [];
  const select = (id: string) => events.push(`select:${id}`);
  const close = () => { events.push("close"); };

  expect(activateHarnessPickerRow(row, select, close)).toBe(true);
  expect(events).toEqual(["select:host/hermes", "close"]);
  events.length = 0;
  // Pressable's native accessibility activate dispatches its onPress handler.
  expect(activateHarnessPickerRow(row, select, close)).toBe(true);
  expect(events).toEqual(["select:host/hermes", "close"]);
});

test("disabled rows never dispatch selection or close, even when previously selected", () => {
  for (const input of [
    { id: "hermes", name: "Hermes", available: false },
    { id: "", name: "Missing ID", available: true },
    { id: "agent", name: "", available: true },
  ]) {
    const events: string[] = [];
    const row = harnessPickerRowA11y(input, input.id);
    expect(activateHarnessPickerRow(row, id => { events.push(id); }, () => { events.push("closed"); })).toBe(false);
    expect(events).toEqual([]);
  }
});

const componentSource = readFileSync(new URL("../components/HarnessPicker.tsx", import.meta.url), "utf8");

test("component wires row name, hint, role, state, disabled and activation together", () => {
  expect(componentSource).toContain('accessibilityRole="button"');
  expect(componentSource).toContain("accessibilityLabel={row.label}");
  expect(componentSource).toContain("accessibilityHint={row.hint}");
  expect(componentSource).toContain("accessibilityState={row.state}");
  expect(componentSource).toContain("disabled={row.disabled}");
  expect(componentSource).toContain("onPress={() => activateHarnessPickerRow(row, onSelect, onClose)}");
  expect(componentSource).toContain("harnessPickerRowA11y(h, selected)");
});

test("modal has a named keyboard/screen-reader exit, isolated focus, and reduced motion", () => {
  expect(componentSource).toContain("onRequestClose={onClose}");
  expect(componentSource).toContain("onAccessibilityEscape={onClose}");
  expect(componentSource).toContain("accessibilityViewIsModal");
  expect(componentSource).toContain('accessibilityRole="header"');
  expect(componentSource).toContain('accessibilityLabel="Close harness picker"');
  expect(componentSource).toContain('accessible={false}');
  expect(componentSource).toContain('focusable={false}');
  expect(componentSource).toContain('animationType={reducedMotion ? "none" : "fade"}');
});

test("row and close control have at least 44 DIP minimum size, with scaling text", () => {
  const minHeights = componentSource.match(/minHeight: 44/g) ?? [];
  expect(minHeights.length).toBe(2);
  expect(componentSource).toContain("minWidth: 44");
  expect(componentSource).not.toContain("allowFontScaling={false}");
  // HarnessInfo has no loading/expanded property; don't synthesize either state.
  expect(componentSource).not.toContain("accessibilityState={{ busy:");
});
