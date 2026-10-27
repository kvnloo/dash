import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const source = readFileSync(join(import.meta.dir, "ContextCard.tsx"), "utf8");
test("context opens in a native modal instantly, never behind the composer or an opacity animation", () => {
  expect(source).toContain('<Modal visible transparent animationType="none" onRequestClose={control.close}>');
  expect(source).not.toContain("Animated");
  expect(source).toContain("if (!control.open) return null");
  expect(source).toContain('accessibilityLabel="Close usage details"');
});
test("the gauge toggles without a reading and unknown metadata stays explicit", () => {
  const gauge = source.slice(source.indexOf("export function ContextGauge"), source.indexOf("function resetLabel"));
  expect(gauge).toContain("onPress={control.toggle}");
  expect(gauge).not.toContain("disabled=");
  expect(gauge).toContain("expanded: control.open");
  expect(source).toContain("Unknown / unknown tokens");
  expect(source).toContain('s?.model ?? "Unknown"');
  expect(source).toContain("sample.compactionSupported");
});
