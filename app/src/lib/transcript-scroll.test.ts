import { expect, test } from "bun:test";
import { clampedShrinkRestore, scheduleLatestIfFollowing, shouldFollowLatest } from "./transcript-scroll";

test("a queued Latest frame cannot override an upward wheel", () => {
  let following = true;
  let pending: (() => void) | undefined;
  let scrolls = 0;
  scheduleLatestIfFollowing(() => following, () => { scrolls += 1; }, callback => { pending = callback; });
  following = false;
  expect(pending).toBeDefined();
  pending?.();
  expect(scrolls).toBe(0);
});

test("a queued Latest frame still follows without reader input", () => {
  let pending: (() => void) | undefined;
  let scrolls = 0;
  scheduleLatestIfFollowing(() => true, () => { scrolls += 1; }, callback => { pending = callback; });
  pending?.();
  expect(scrolls).toBe(1);
});

test("a layout scroll cannot re-arm Latest during an upward wheel", () => {
  expect(shouldFollowLatest(true, true)).toBe(false);
  expect(shouldFollowLatest(false, false)).toBe(false);
  expect(shouldFollowLatest(true, false)).toBe(true);
});

// ARMY-WHEEL-RESET-1106: measured shape (h 47477 -> 46094, clamped to the bottom mid-wheel).
test("a shrink that clamps an upward-wheeling reader to the bottom restores their distance from the bottom", () => {
  const before = { contentHeight: 47477, viewportHeight: 579, offset: 46398 };
  const clamped = { contentHeight: 46094, viewportHeight: 579, offset: 46094 - 579 };
  expect(clampedShrinkRestore(before, clamped, true, false)).toBe(46094 - 579 - 500);
});

test("the shrink guard leaves following, downward, grown and unclamped cases alone", () => {
  const before = { contentHeight: 47477, viewportHeight: 579, offset: 46398 };
  const clamped = { contentHeight: 46094, viewportHeight: 579, offset: 46094 - 579 };
  expect(clampedShrinkRestore(before, clamped, false, false)).toBeNull();
  expect(clampedShrinkRestore(before, clamped, true, true)).toBeNull();
  expect(clampedShrinkRestore(before, { ...clamped, contentHeight: 47477, offset: 46898 }, true, false)).toBeNull();
  expect(clampedShrinkRestore(before, { ...clamped, offset: 44765 }, true, false)).toBeNull();
  expect(clampedShrinkRestore({ ...before, offset: 46898 }, clamped, true, false)).toBeNull();
});
