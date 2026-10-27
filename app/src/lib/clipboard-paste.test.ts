import { expect, test } from "bun:test";
import { clipboardInsertion, clipboardPng } from "./clipboard-paste";

test("URI pastes preserve text on both sides and restore replaced selections", () => {
  expect(clipboardInsertion("Before  after", "Before content://media/images/123 after")).toEqual({ contentUri: true, withoutUri: "Before  after" });
  expect(clipboardInsertion("replace", "content://media/1")).toEqual({ contentUri: true, withoutUri: "" });
  expect(clipboardInsertion("", "content://media/1")).toEqual({ contentUri: true, withoutUri: "" });
});
test("ordinary typing, unchanged text and deletion do not read the clipboard", () => {
  for (const [previous, next] of [["", "a"], ["abc", "abcd"], ["same", "same"], ["abc", "ab"], ["abc", "aXc"]]) expect(clipboardInsertion(previous ?? "", next ?? "")).toBeNull();
});
test("bulk text may check for an image but never strips ordinary text or existing URIs", () => {
  expect(clipboardInsertion("before ", "before pasted text")).toEqual({ contentUri: false, withoutUri: "before pasted text" });
  expect(clipboardInsertion("content://media/1 ", "content://media/1 hello")).toEqual({ contentUri: false, withoutUri: "content://media/1 hello" });
  expect(clipboardInsertion("", "mention content://media/1")).toEqual({ contentUri: false, withoutUri: "mention content://media/1" });
});
test("PNG data URLs yield only base64 and actual byte counts including padding", () => {
  expect(clipboardPng("data:image/png;base64,YWJj")).toEqual({ base64: "YWJj", size: 3 });
  expect(clipboardPng("data:image/png;base64,YWI=")).toEqual({ base64: "YWI=", size: 2 });
  expect(clipboardPng("data:image/png;base64,YQ==")).toEqual({ base64: "YQ==", size: 1 });
  for (const data of ["", "YWJj", "data:image/jpeg;base64,YWJj", "data:image/png;base64,", "data:image/png;base64,a", "data:image/png;base64,!!!!"]) expect(clipboardPng(data)).toBeNull();
});
