import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  PERMISSION_BADGE_MIN_HIT,
  PERMISSION_BADGE_VISIBLE_LIMIT,
  formatPermissionCount,
  permissionCountReviewLabel,
} from "./permission-badge";

describe("Needs OK badge copy", () => {
  test("zero count hides instead of claiming an approval is waiting", () => {
    expect(formatPermissionCount(0)).toBeNull();
    expect(permissionCountReviewLabel(0)).toBeNull();
    expect(formatPermissionCount(-0)).toBeNull();
  });

  test("one pending request uses Needs OK and a singular review action", () => {
    expect(formatPermissionCount(1)).toBe("1 needs OK");
    expect(permissionCountReviewLabel(1)).toBe("Review 1 request needing OK");
  });

  test("many pending requests use the count and explicit Needs OK vocabulary", () => {
    expect(formatPermissionCount(2)).toBe("2 needs OK");
    expect(formatPermissionCount(27)).toBe("27 needs OK");
    expect(permissionCountReviewLabel(27)).toBe("Review 27 requests needing OK");
    expect(formatPermissionCount(27)).not.toBe("ask");
  });

  test("large counts compact visually but remain exact for accessibility", () => {
    expect(PERMISSION_BADGE_VISIBLE_LIMIT).toBe(99);
    expect(formatPermissionCount(99)).toBe("99 needs OK");
    expect(formatPermissionCount(100)).toBe("99+ needs OK");
    expect(formatPermissionCount(100_000)).toBe("99+ needs OK");
    expect(permissionCountReviewLabel(100)).toBe("Review 100 requests needing OK");
    expect(permissionCountReviewLabel(100_000)).toBe("Review 100000 requests needing OK");
    expect(formatPermissionCount(Number.MAX_SAFE_INTEGER)).toBe("99+ needs OK");
    expect(permissionCountReviewLabel(Number.MAX_SAFE_INTEGER))
      .toBe("Review 9007199254740991 requests needing OK");
  });

  test("invalid, fractional, negative or unsafe inputs never create a badge", () => {
    const invalid: unknown[] = [
      -1, -12, 0.1, 1.5, NaN, Infinity, -Infinity,
      Number.MAX_SAFE_INTEGER + 1, undefined, null, "3", true, [], {},
    ];
    for (const value of invalid) {
      expect(formatPermissionCount(value)).toBeNull();
      expect(permissionCountReviewLabel(value)).toBeNull();
    }
  });
});

test("source-backed standalone mount checklist (not rendered or device evidence)", () => {
  expect(PERMISSION_BADGE_MIN_HIT).toBeGreaterThanOrEqual(44);
  const component = readFileSync(new URL("../components/PermissionBadge.tsx", import.meta.url), "utf8");
  expect(component).toContain("export function PermissionBadge");
  expect(component).toContain("formatPermissionCount(count)");
  expect(component).toContain("permissionCountReviewLabel(count)");
  expect(component).toContain('accessibilityRole="button"');
  expect(component).toContain("accessibilityLabel={accessibilityLabel}");
  expect(component).toContain("onPress={onPress}");
  expect(component).toContain("if (visibleLabel === null || accessibilityLabel === null) return null");
  expect(component).toContain("minHeight: PERMISSION_BADGE_MIN_HIT");
  expect(component).toContain("minWidth: PERMISSION_BADGE_MIN_HIT");
  expect(component).not.toContain("store.use(");
  expect(component).not.toContain("setInterval(");
});
