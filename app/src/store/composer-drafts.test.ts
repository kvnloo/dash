import { expect, mock, test } from "bun:test";
import type { ComposerDraft } from "./composer-drafts";
// This file must run alone too; depending on another test's RN mock makes CI order-dependent.
mock.module("react-native", () => ({ AppState: { currentState: "active", addEventListener() { return { remove() {} }; } } }));
mock.module("@react-native-async-storage/async-storage", () => ({ default: { getItem: async () => null, setItem: async () => undefined } }));
const { composerDrafts, updateComposerDraft } = await import("./composer-drafts");

test("a draft and late upload completion stay bound to the original conversation across navigation", () => {
  composerDrafts.set({});
  const seed: ComposerDraft = { text: "original unsent text", attachments: [{ key: "file", name: "ink.png", mime: "image/png", size: 4, uri: "file://owned", state: "uploading" }] };
  updateComposerDraft("attached-chat", seed, draft => ({ ...draft, text: draft.text + "\nsecond line" }));
  updateComposerDraft("other-chat", { text: "other draft", attachments: [] }, draft => draft);
  updateComposerDraft("attached-chat", seed, draft => ({ ...draft, attachments: draft.attachments.map(file => ({ ...file, state: "error", error: "offline" })) }));
  expect(composerDrafts.get()["attached-chat"]?.text).toBe("original unsent text\nsecond line");
  expect(composerDrafts.get()["attached-chat"]?.attachments[0]?.error).toBe("offline");
  expect(composerDrafts.get()["other-chat"]?.text).toBe("other draft");
  // A remount's empty seed cannot replace the retained draft.
  updateComposerDraft("attached-chat", { text: "", attachments: [] }, draft => draft);
  expect(composerDrafts.get()["attached-chat"]?.text).toBe("original unsent text\nsecond line");
});
