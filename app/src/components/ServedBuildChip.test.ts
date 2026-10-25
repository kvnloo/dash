import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseServedBuild,
  servedAgeLabel,
  servedBuildKey,
  servedBuildLabel,
  shouldShowServedChip,
} from "../turbo";

describe("turbo served build identity", () => {
  test("accepts a Git hex SHA, shortens only its visual label, and rejects unsafe values", () => {
    const build = parseServedBuild("  A1b2C3d4e5f60123456789abcdef123456789012  ", "2026-10-25T17:10:00Z");
    expect(build).toEqual({ sha: "a1b2c3d4e5f60123456789abcdef123456789012", servedAtMs: 1792948200000 });
    expect(servedBuildLabel(build, 1792948260000)).toBe("a1b2c3d · 1m old");
    expect(parseServedBuild("not-a-sha", "invalid")).toEqual({ sha: null, servedAtMs: null });
  });

  test("parses ISO and Unix-second/millisecond served timestamps without guessing", () => {
    expect(parseServedBuild("deadbee", "1792948200").servedAtMs).toBe(1792948200000);
    expect(parseServedBuild("deadbee", "1792948200000").servedAtMs).toBe(1792948200000);
    expect(parseServedBuild("deadbee", "2026-10-25").servedAtMs).toBeNull();
    expect(parseServedBuild(undefined, undefined)).toEqual({ sha: null, servedAtMs: null });
    expect(servedBuildLabel(parseServedBuild(undefined, undefined), 1792948260000))
      .toBe("SHA ? · age unknown");
  });

  test("ages advance at minute, hour, and day boundaries with clock skew called out", () => {
    const now = 1792948200000;
    expect(servedAgeLabel(now, now)).toBe("just served");
    expect(servedAgeLabel(now - 59_999, now)).toBe("just served");
    expect(servedAgeLabel(now - 60_000, now)).toBe("1m old");
    expect(servedAgeLabel(now - 3_600_000, now)).toBe("1h old");
    expect(servedAgeLabel(now - 86_400_000, now)).toBe("1d old");
    expect(servedAgeLabel(now + 60_001, now)).toBe("clock skew");
    expect(servedAgeLabel(null, now)).toBe("age unknown");
  });

  test("never appears outside turbo, hides on tap, and returns for another served bundle", () => {
    const first = parseServedBuild("abcdefa", "1792948200");
    const second = parseServedBuild("abcdefb", "1792948201");
    expect(shouldShowServedChip(false, null, first)).toBe(false);
    expect(shouldShowServedChip(true, null, first)).toBe(true);
    expect(shouldShowServedChip(true, servedBuildKey(first), first)).toBe(false);
    expect(shouldShowServedChip(true, servedBuildKey(first), second)).toBe(true);
  });

  test("native chip has a 44dp touch target, a hide action, and no motion", () => {
    const source = readFileSync(join(import.meta.dir, "ServedBuildChip.tsx"), "utf8");
    expect(source).toContain("minWidth: controlMin, minHeight: controlMin");
    expect(source).toContain('accessibilityRole="button"');
    expect(source).toContain("onPress={() => setHiddenFor(key)}");
    expect(source).not.toContain("Animated");
  });
});
