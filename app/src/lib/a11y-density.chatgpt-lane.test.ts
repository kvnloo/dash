import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DENSITIES } from "./tile-layout";
import { largeTypePreviewControl } from "./a11y-density";

const pickerSource = readFileSync(join(import.meta.dir, "../components/Density.tsx"), "utf8");
const pressScaleSource = readFileSync(join(import.meta.dir, "../components/PressScale.tsx"), "utf8");

describe("DensityPicker accessibility contract", () => {
  test("normal type preview announces its current size and exact next action", () => {
    expect(largeTypePreviewControl(1)).toEqual({
      accessibilityLabel: "Large type preview off, 100 percent. Activate to preview 160 percent.",
      accessibilityState: { selected: false, disabled: false },
      nextScale: 1.6,
    });
  });

  test("selected large type announces its current size and restores normal size", () => {
    expect(largeTypePreviewControl(1.6)).toEqual({
      accessibilityLabel: "Large type preview on, 160 percent. Activate to restore 100 percent.",
      accessibilityState: { selected: true, disabled: false },
      nextScale: 1,
    });
    expect(largeTypePreviewControl(largeTypePreviewControl(1).nextScale ?? 0).nextScale).toBe(1);
  });

  test("nondefault valid scale is announced, not silently called 160 percent", () => {
    expect(largeTypePreviewControl(1.25)).toEqual({
      accessibilityLabel: "Large type preview on, 125 percent. Activate to restore 100 percent.",
      accessibilityState: { selected: true, disabled: false },
      nextScale: 1,
    });
  });

  test("unavailable scales never announce invented percentages or offer an action", () => {
    for (const value of [Number.NaN, Infinity, -Infinity, Number.MAX_VALUE, 0, -1]) {
      expect(largeTypePreviewControl(value)).toEqual({
        accessibilityLabel: "Large type preview unavailable",
        accessibilityState: { selected: false, disabled: true },
        nextScale: undefined,
      });
    }
  });

  test("all three density choices remain labelled, selected and pressable by the same action", () => {
    expect(DENSITIES).toEqual(["compact", "comfortable", "rich"]);
    expect(pickerSource).toContain("DENSITIES.map(value => <PressScale");
    expect(pickerSource).toContain('accessibilityLabel={`${value} density`}');
    expect(pickerSource).toContain("accessibilityState={{ selected: density === value }}");
    expect(pickerSource).toContain('accessibilityHint={density === value ? "Current density" : `Activate to use ${value} density`}');
    expect(pickerSource).toContain("onPress={() => setDensity(value)}");
    expect(pickerSource).toContain('testID={`density-${value}`}');
  });

  test("large-type screen-reader activation uses the touch target and true disabled state", () => {
    expect(pickerSource).toContain("const preview = largeTypePreviewControl(typeScale);");
    expect(pickerSource).toContain("onPress={() => { if (preview.nextScale !== undefined) setTypeScale(preview.nextScale); }}");
    expect(pickerSource).toContain("accessibilityLabel={preview.accessibilityLabel}");
    expect(pickerSource).toContain("accessibilityState={preview.accessibilityState}");
    expect(pickerSource).toContain("disabled={preview.accessibilityState.disabled}");
    expect((pickerSource.match(/accessibilityRole="button"/g) ?? []).length).toBe(2);
    // PressScale forwards accessibility props to Pressable; native press and accessibility activation share onPress.
    expect(pressScaleSource).toContain("{...rest}");
    expect(pressScaleSource).toContain("disabled={disabled}");
    expect(pressScaleSource).toContain("onPress={e => { if (!swiping?.value) onPress?.(e); }}");
  });

  test("both control families retain 44 DIP minimums, font scaling and wrapping", () => {
    expect((pickerSource.match(/minHeight: 44/g) ?? []).length).toBe(2);
    expect((pickerSource.match(/allowFontScaling/g) ?? []).length).toBe(2);
    expect(pickerSource).toContain('flexWrap: "wrap"');
  });
});
