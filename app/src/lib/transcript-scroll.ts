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
