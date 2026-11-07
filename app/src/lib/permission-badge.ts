/** A self-contained view model for a pending ACP permission-request count. */
export const PERMISSION_BADGE_MIN_HIT = 44;
export const PERMISSION_BADGE_VISIBLE_LIMIT = 99;

/** A missing, stale, fractional or otherwise invalid count is not a pending request. */
function isPendingCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Compact display copy; no count is inferred from an invalid input. */
export function formatPermissionCount(count: unknown): string | null {
  if (!isPendingCount(count)) return null;
  const visible = count > PERMISSION_BADGE_VISIBLE_LIMIT
    ? String(PERMISSION_BADGE_VISIBLE_LIMIT) + "+"
    : String(count);
  return visible + " needs OK";
}

/** Screen readers always receive the exact count, even when the badge is compact. */
export function permissionCountReviewLabel(count: unknown): string | null {
  if (!isPendingCount(count)) return null;
  return "Review " + count + " " + (count === 1 ? "request" : "requests") + " needing OK";
}
