import { keyboardInset } from "./keyboard-inset";

export type QuickScrollDirection = "up" | "down" | "none";
export type QuickScrollKind = "up" | "down";

export interface QuickScrollState {
  down: { visible: boolean; bottom: number; badge?: number };
  up: { visible: boolean; top: number };
}

export interface QuickScrollInput {
  contentHeight: number;
  viewportHeight: number;
  offset: number;
  keyboardHeight: number;
  composerHeight: number;
  bottomInset: number;
  following: boolean;
  unseen: number;
  /** Direction of the last *user* scroll gesture, not a programmatic scroll. */
  direction?: QuickScrollDirection;
  /** Supply the prior result on each update to retain the 40px hide threshold. */
  previous?: QuickScrollState;
}

const GAP = 8;
const HIDE_WITHIN_END = 40;

function nonnegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Offset in the scrollable list, clamped for short or invalid content. */
export function jumpTarget(kind: QuickScrollKind, contentHeight: number, viewportHeight: number): number {
  if (kind === "up") return 0;
  return Math.max(0, nonnegative(contentHeight) - nonnegative(viewportHeight));
}

/**
 * Pure visibility and placement for transcript jump controls.
 * The caller owns gesture direction and passes `previous` for hysteresis; this
 * model neither subscribes to the keyboard nor changes the list's follow mode.
 * All positions are in viewport-relative pixels, before the caller's style.
 */
export function quickScroll(input: QuickScrollInput): QuickScrollState {
  const viewport = nonnegative(input.viewportHeight);
  const end = jumpTarget("down", input.contentHeight, viewport);
  const offset = Math.min(end, nonnegative(input.offset));
  const distanceToEnd = end - offset;
  const scrollable = viewport > 0 && end > 0;

  // KeyboardController reports an open IME as a negative height. When closed,
  // use the actual bottom safe area; never stack it on top of the IME inset.
  const ime = keyboardInset(Number.isFinite(input.keyboardHeight) ? input.keyboardHeight : 0);
  const bottomSpace = ime > 0 ? ime : nonnegative(input.bottomInset);
  const bottom = Math.min(viewport / 2, bottomSpace + nonnegative(input.composerHeight) + GAP);
  const top = Math.min(GAP, viewport / 2);

  // A fresh control appears after >1 viewport from the end. Once visible it
  // stays visible until <=40px from the end, even during short scrolls back.
  const showDown = scrollable && !input.following && (
    input.previous?.down.visible === true
      ? distanceToEnd > HIDE_WITHIN_END
      : distanceToEnd > viewport
  );
  const showUp = scrollable && offset > 2 * viewport && input.direction === "up";
  const unseen = nonnegative(input.unseen);
  const badge = unseen > 0 ? Math.ceil(unseen) : undefined;

  return {
    down: badge === undefined ? { visible: showDown, bottom } : { visible: showDown, bottom, badge },
    up: { visible: showUp, top },
  };
}

/** Preserve the numeric unseen count in state; cap only the rendered label. */
export function quickScrollBadgeLabel(count: number | undefined): string | undefined {
  if (count === undefined || !Number.isFinite(count) || count <= 0) return undefined;
  const integer = Math.ceil(count);
  return integer > 99 ? "99+" : String(integer);
}
