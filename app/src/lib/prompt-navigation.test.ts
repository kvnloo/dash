import { expect, test } from "bun:test";
import { promptAnchors, promptOffset, railTarget, followsLatest } from "./prompt-navigation";

test("prompt index maps to message index and measured offset, not estimated row height", () => {
  const anchors = promptAnchors([{ id: "u1", role: "user", text: "First" }, { id: "a1", role: "assistant", text: "Long answer" }, { id: "u2", role: "user", text: "Second" }]);
  expect(anchors.map(a => a.index)).toEqual([0, 2]);
  expect(promptOffset(anchors, 1, i => ({ y: i === 2 ? 984 : 8 }))).toBe(984);
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
