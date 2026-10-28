import {
  CLOSE_HIT,
  PILL_GAP,
  pillReserve,
  type PillGeometry,
} from "./chat-window";

export type FullscreenCloseSide = "left" | "right";

export interface FullscreenCloseBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const EDGE_INSET = 8;
const PILL_CLEARANCE = 8;

/** Only an observed title or the supplied harness is announced; empty statuses are omitted. */
export function fullscreenPillLabel(
  title: string,
  status: readonly string[],
  harnessName = "Chat",
): string {
  const name = title.trim() || harnessName.trim() || "Chat";
  const entries = status.map(value => value.trim()).filter(value => value.length > 0);
  return [name, ...entries].join(", ");
}

export function fullscreenCloseLabel(): string {
  return "Close chat";
}

export function fullscreenPillState(pillOpen: boolean): Readonly<{ expanded: boolean }> {
  return { expanded: pillOpen };
}

/**
 * A cutout pill can occupy the entire top row on narrow phones.
 * Move the 44-DIP X below it instead of covering the camera or the pill.
 * Both sides use actual window width; handedness is supplied by the caller.
 */
export function fullscreenCloseBounds(
  geometry: PillGeometry,
  windowWidth: number,
  closeSide: FullscreenCloseSide,
): FullscreenCloseBounds {
  const maxLeft = Math.max(0, windowWidth - CLOSE_HIT);
  const left = closeSide === "left"
    ? Math.min(EDGE_INSET, maxLeft)
    : Math.max(0, maxLeft - EDGE_INSET);
  const alignedTop = Math.max(0, geometry.top + (geometry.height - CLOSE_HIT) / 2);
  const horizontalOverlap = left < geometry.left + geometry.width + PILL_CLEARANCE
    && left + CLOSE_HIT + PILL_CLEARANCE > geometry.left;
  const top = horizontalOverlap
    ? Math.max(alignedTop, geometry.top + geometry.height + PILL_CLEARANCE)
    : alignedTop;
  return { left, top, width: CLOSE_HIT, height: CLOSE_HIT };
}

/** Inset the transcript below whichever chrome element extends farthest. */
export function fullscreenChromeReserve(
  geometry: PillGeometry,
  windowWidth: number,
  closeSide: FullscreenCloseSide,
  insetTop = 0,
): number {
  const close = fullscreenCloseBounds(geometry, windowWidth, closeSide);
  return Math.max(pillReserve(geometry, insetTop), close.top + close.height + PILL_GAP);
}
