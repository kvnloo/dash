import { describe, expect, test } from "bun:test";
import { NOTICE_BODY_MAX, NOTICE_TITLE_MAX, parseNoticeInput, parseServerMessage, PROTOCOL_VERSION } from "./protocol";
const input = { title: "Build ready", body: "Tests passed", url: "dash://chat/c1" };
describe("agent notice protocol", () => {
  test("additive v1 message with optional URL", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(NOTICE_TITLE_MAX).toBe(80); expect(NOTICE_BODY_MAX).toBe(600);
    expect(parseNoticeInput(input)).toEqual(input);
    expect(parseServerMessage({ type: "notice", id: "n1", ...input })).toEqual({ type: "notice", id: "n1", ...input });
    expect(parseServerMessage({ type: "notice", id: "n1", title: "T", body: "B" })).toEqual({ type: "notice", id: "n1", title: "T", body: "B" });
    expect(parseServerMessage({ type: "future_notice", id: "n1", ...input })).toBeNull();
  });
  test("pins exact caps", () => {
    expect(parseNoticeInput({ title: "t".repeat(80), body: "b".repeat(600) })).not.toBeNull();
    for (const bad of [{ title: "t".repeat(81), body: "b" }, { title: "t", body: "b".repeat(601) }, { title: "", body: "b" }, { title: "t", body: "" }, { title: " ", body: "b" }, { title: "t", body: " " }]) expect(parseNoticeInput(bad)).toBeNull();
  });
  test("untrusted fields fail closed", () => {
    for (const raw of [null, [], 1, {}, { ...input, title: 1 }, { ...input, body: null }, { ...input, url: 42 }, { ...input, url: "javascript:alert(1)" }, { ...input, url: "http://example.com" }, { ...input, url: "dash://" }, { ...input, url: "dash://chat/" + "x".repeat(512) }]) expect(parseNoticeInput(raw)).toBeNull();
    for (const id of [undefined, null, 1, "", "x".repeat(129)]) expect(parseServerMessage({ type: "notice", id, ...input })).toBeNull();
    expect(parseNoticeInput({ ...input, extra: "ignored" })).toEqual(input);
  });
});
