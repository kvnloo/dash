import { expect, test } from "bun:test";
import { parseNoticeInput, parseServerMessage } from "./protocol";
import { CLASSES } from "./interaction-policy";

const legacy = { title: "Synthetic report", body: "A bounded update" };
test("notice policy fields are additive and survive the wire parser", () => {
  expect(parseNoticeInput(legacy)).toEqual(legacy);
  for (const cls of CLASSES) {
    const input = { ...legacy, class: cls, not_before: "2026-10-28T08:00:00-04:00" };
    expect(parseNoticeInput(input)).toEqual(input);
    expect(parseServerMessage({ ...input, type: "notice", id: "synthetic" })).toEqual({ ...input, type: "notice", id: "synthetic" });
  }
});
test("notice policy rejects invalid classes and timestamps without an explicit ISO offset", () => {
  for (const cls of ["urgent", "", null, 1, {}, []]) expect(parseNoticeInput({ ...legacy, class: cls })).toBeNull();
  for (const not_before of [null, 3, "tomorrow", "2026-10-28", "2026-10-28T08:00:00", "2026-13-28T08:00:00Z", "2026-02-30T08:00:00Z", "2026-10-28T25:00:00Z"]) {
    expect(parseNoticeInput({ ...legacy, not_before })).toBeNull();
  }
  expect(parseNoticeInput({ ...legacy, not_before: "2026-10-28T12:00:00Z" })).not.toBeNull();
});
