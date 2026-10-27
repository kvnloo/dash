import { space } from "../theme";

export type QuickScrollDirection = "down" | "up";
export type QuickScrollSide = "left" | "right";

/** No transparent press target remains in the transcript when the control is hidden. */
export function shouldRenderQuickScroll(visible: boolean): boolean {
  return visible === true;
}

function unreadCount(badge?: number): number {
  if (badge === undefined || !Number.isFinite(badge) || badge < 1) return 0;
  return Math.floor(badge);
}

/** Visual count is capped, so the announcement never contradicts the badge. */
export function quickScrollBadge(badge?: number): string | null {
  const count = unreadCount(badge);
  if (count === 0) return null;
  return count > 99 ? "99+" : String(count);
}

export function quickScrollLabel(direction: QuickScrollDirection, badge?: number): string {
  if (direction === "up") return "Jump to top";
  const count = unreadCount(badge);
  if (count === 0) return "Jump to latest";
  const countLabel = quickScrollBadge(count);
  return "Jump to latest, " + countLabel + " new " + (count === 1 ? "message" : "messages");
}

/** Only the physical anchor mirrors; reading order and arrow direction do not. */
export function quickScrollSidePosition(side: QuickScrollSide) {
  return side === "left" ? { left: space.lg } : { right: space.lg };
}

/** Offset already accounts for keyboard height in the upstream quick-scroll model. */
export function quickScrollPosition(
  direction: QuickScrollDirection,
  offset: number,
  side: QuickScrollSide,
) {
  const inset = Number.isFinite(offset) ? Math.max(0, offset) : 0;
  const vertical = direction === "down" ? { bottom: inset } : { top: inset };
  return { ...vertical, ...quickScrollSidePosition(side) };
}
