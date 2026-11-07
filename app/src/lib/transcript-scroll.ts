/**
 * A content-size change can queue a frame while following is still enabled.
 * Recheck at execution, after wheel/touch input has had a chance to detach the reader.
 */
export function scheduleLatestIfFollowing(
  isFollowing: () => boolean,
  scroll: () => void,
  schedule: (callback: () => void) => void,
): void {
  schedule(() => { if (isFollowing()) scroll(); });
}

/** A synthetic layout scroll at Latest cannot undo an explicit upward wheel. */
export function shouldFollowLatest(atLatest: boolean, upwardWheel: boolean): boolean {
  return atLatest && !upwardWheel;
}

export interface TranscriptExtent { contentHeight: number; viewportHeight: number; offset: number }

/**
 * Web: rows above the reader can be re-measured shorter while they scroll up. The browser then clamps
 * scrollTop to the new bottom, and the list's own position correction sometimes misses it, which drops
 * the reader at Latest mid-wheel. An upward wheel never lands at the bottom, so when the content shrank
 * and the reader sits clamped at the bottom, return the offset that restores their distance from the
 * bottom (the shrunk rows were above them); otherwise null.
 */
export function clampedShrinkRestore(previous: TranscriptExtent, next: TranscriptExtent, upwardWheel: boolean, following: boolean): number | null {
  if (!upwardWheel || following) return null;
  if (next.contentHeight >= previous.contentHeight - 1) return null;
  const nextMax = Math.max(0, next.contentHeight - next.viewportHeight);
  if (nextMax - next.offset > 1) return null;
  const distance = previous.contentHeight - previous.viewportHeight - previous.offset;
  if (distance <= 1) return null;
  return Math.max(0, nextMax - distance);
}
