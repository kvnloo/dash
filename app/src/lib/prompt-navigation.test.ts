import { expect, test } from "bun:test";
import { promptAnchors, promptOffset, railTarget, railLayout, railTargetAt, followsLatest } from "./prompt-navigation";

test("prompt index maps to message index and measured offset, not estimated row height", () => {
  const anchors = promptAnchors([{ id: "u1", role: "user", text: "First" }, { id: "a1", role: "assistant", text: "Long answer" }, { id: "u2", role: "user", text: "Second" }]);
  expect(anchors.map(a => a.index)).toEqual([0, 2]);
  expect(promptOffset(anchors, 1, i => ({ y: i === 2 ? 984 : 8, isHeightMeasured: true }))).toBe(984);
  expect(promptOffset(anchors, 1, i => ({ y: i * 90, isHeightMeasured: i > 0 }))).toBeNull();
  expect(promptOffset(anchors, 9, () => undefined)).toBeNull();
  expect(promptOffset(anchors, 0, () => undefined)).toBeNull();
});
test("rail clamps outside drags and reserves a latest target", () => {
  expect(railTarget(-12, 240, 24)).toBe(0);
  expect(railTarget(239, 240, 24)).toBe(23);
  expect(railTarget(260, 240, 24)).toBe(24);
  expect(railTarget(999, 0, 0)).toBe(0);
});
test("follow resumes only near bottom or by explicit latest action", () => {
  expect(followsLatest(1200, 600, 0)).toBe(false);
  expect(followsLatest(1200, 600, 552)).toBe(true);
  expect(followsLatest(1200, 600, 551)).toBe(false);
  expect(followsLatest(300, 600, 0)).toBe(true);
});

test("linear run segments put 5 minute prompts close and 3 hour prompts far apart", () => {
  const positions = railLayout([300000, 10800000, 0], 600);
  const first = positions[0] ?? 0, second = positions[1] ?? 0, third = positions[2] ?? 0;
  expect(first).toBe(3);
  expect((third - second - 6) / (second - first - 6)).toBeCloseTo(36);
  expect(third).toBeCloseTo(597);
});
test("minimum gaps, monotonic positions, zero duration and equal-spacing overflow", () => {
  for (const durations of [[0, 0, 0], [0, 999999, 0, 1], [-1, NaN, Infinity, 2]]) {
    const positions = railLayout(durations, 120);
    for (let i = 1; i < positions.length; i++) expect((positions[i] ?? 0) - (positions[i - 1] ?? 0)).toBeGreaterThanOrEqual(6);
    expect(positions.at(-1)).toBeLessThan(120);
  }
  expect(railLayout([1, 100, 0], 12)).toEqual([2, 6, 10]);
  expect(railLayout([1, 100, 0], 18)).toEqual([3, 9, 15]);
  expect(railLayout([], 12)).toEqual([]);
  expect(railLayout([1], 0)).toEqual([0]);
});
test("nearest tick uses variable midpoint boundaries and reserves Latest", () => {
  const positions = [3, 15, 99];
  expect(railTargetAt(-20, positions, 120)).toBe(0);
  expect(railTargetAt(8.9, positions, 120)).toBe(0);
  expect(railTargetAt(9, positions, 120)).toBe(1);
  expect(railTargetAt(56.9, positions, 120)).toBe(1);
  expect(railTargetAt(57, positions, 120)).toBe(2);
  expect(railTargetAt(119, positions, 120)).toBe(2);
  expect(railTargetAt(120, positions, 120)).toBe(3);
  expect(railTargetAt(0, [], 120)).toBe(0);
});
