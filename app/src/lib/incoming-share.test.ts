import { expect, test } from "bun:test";
import { isShareLink, parseIncomingShare } from "./incoming-share";
import { canSendDrafts, MAX_ATTACHMENT_BYTES, readyRefs, type DraftAttachment } from "./attachments";
const id = "11111111-1111-4111-8111-111111111111";
const file = { uri: `file:///cache/incoming-shares/${id}/0-report.bin`, name: "report.bin", mime: "application/octet-stream", size: 4 };
const payload = { id, text: "https://example.com", files: [file], errors: [] };
test("accepts arbitrary single/multiple files and URL text without network resolution", () => {
  expect(parseIncomingShare(payload)?.files).toEqual([file]);
  expect(parseIncomingShare({ ...payload, files: [file, { ...file, name: "archive.zip", mime: "application/zip" }] })?.files).toHaveLength(2);
  expect(parseIncomingShare({ ...payload, files: [] })?.text).toBe("https://example.com");
});
test("rejects malformed, uncached, traversal, oversized, empty and excessive files", () => {
  for (const bad of [null, {}, { ...payload, text: "x".repeat(60001) }, { ...payload, errors: [42] }, { ...payload, files: Array(9).fill(file) },
    ...[0, -1, 0.5, MAX_ATTACHMENT_BYTES + 1].map(size => ({ ...payload, files: [{ ...file, size }] })),
    ...["content://provider/file", "https://example.com/a", `file:///cache/incoming-shares/${id}/../secret`].map(uri => ({ ...payload, files: [{ ...file, uri }] })),
    { ...payload, files: Array(3).fill({ ...file, size: MAX_ATTACHMENT_BYTES }) }]) expect(parseIncomingShare(bad)).toBeNull();
});
test("shared files cannot be sent or exposed as upload references before explicit upload", () => {
  const drafts: DraftAttachment[] = [{ ...file, key: "local", state: "local" }];
  expect(canSendDrafts("message", drafts)).toBe(false);
  expect(readyRefs(drafts)).toEqual([]);
  expect(canSendDrafts("message", [{ ...drafts[0]!, state: "uploading" }])).toBe(false);
  expect(canSendDrafts("message", [])).toBe(true);
});
test("only the share-target callback triggers share consumption", () => {
  expect(isShareLink("dash://expo-sharing")).toBe(true);
  expect(isShareLink("https://expo-sharing")).toBe(false);
  expect(isShareLink(null)).toBe(false);
});
