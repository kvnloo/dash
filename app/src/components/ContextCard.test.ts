import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "ContextCard.tsx"), "utf8");
test("context details render immediately above the elevated composer, without entrance animation", () => {
  expect(source).toContain('<View style={[styles.card, { maxHeight:');
  expect(source).not.toContain("Animated.timing(opacity");
  expect(source).not.toContain("new Animated.Value(0)");
  expect(source).toMatch(/card:.*zIndex: 20, elevation: 20/);
  expect(source).toContain("if (!control.open) return null");
});
test("the gauge toggles even without a snapshot and retains an accessible unavailable state", () => {
  const gauge = source.slice(source.indexOf("export function ContextGauge"), source.indexOf("function resetLabel"));
  expect(gauge).toContain("onPress={control.toggle}");
  expect(gauge).not.toContain("disabled=");
  expect(gauge).toContain("expanded: control.open");
  expect(source).toContain("toggle: () => setOpen(v => {");
  expect(source).toContain("return !v;");
  expect(source).toContain("No native reading");
});
