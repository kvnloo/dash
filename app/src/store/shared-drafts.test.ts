import { afterEach, expect, test } from "bun:test";
import { consumeSharedDraft, sharedDrafts, stageSharedDraft } from "./shared-drafts";
import type { IncomingShare } from "../lib/incoming-share";
const share: IncomingShare = { id: "11111111-1111-4111-8111-111111111111", text: "Review this", files: [], errors: [] };
afterEach(() => sharedDrafts.set({}));
test("destination staging is local and cannot overwrite an unread shared draft", () => {
  expect(stageSharedDraft("chat-a", share)).toBe(true);
  expect(sharedDrafts.get()["chat-a"]).toEqual(share);
  expect(sharedDrafts.get()["chat-b"]).toBeUndefined();
  expect(stageSharedDraft("chat-a", { ...share, text: "replacement" })).toBe(false);
  expect(sharedDrafts.get()["chat-a"]?.text).toBe("Review this");
  consumeSharedDraft("chat-a", "different-share");
  expect(sharedDrafts.get()["chat-a"]).toBeDefined();
  consumeSharedDraft("chat-a", share.id);
  expect(sharedDrafts.get()["chat-a"]).toBeUndefined();
});
