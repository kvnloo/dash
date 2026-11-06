import { expect, test } from "bun:test";
import { scheduleLatestIfFollowing, shouldFollowLatest } from "./transcript-scroll";

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
