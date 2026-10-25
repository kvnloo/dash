import { expect, mock, test } from "bun:test";
import type { ComposerDraft } from "./composer-drafts";

// This file must run alone too; depending on another test's RN mock makes CI order-dependent.
const KEY = "dash.composerDrafts.v1";
let storageReads = 0;
const storageWrites: string[] = [];
const appStateListeners = new Set<(state: string) => void>();

mock.module("react-native", () => ({
  Platform: { OS: "android" },
  AppState: {
    currentState: "active",
    addEventListener(event: string, listener: (state: string) => void) {
      expect(event).toBe("change");
      appStateListeners.add(listener);
      return { remove() { appStateListeners.delete(listener); } };
    },
  },
}));
mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    async getItem(key: string) {
      expect(key).toBe(KEY);
      storageReads += 1;
      return null;
    },
    async setItem(key: string, value: string) {
      expect(key).toBe(KEY);
      storageWrites.push(value);
    },
  },
}));

const originalModule = await import("./composer-drafts");
const { composerDrafts, updateComposerDraft } = originalModule;

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

test("Fast Refresh re-evaluates the module without losing an unflushed draft or duplicating writers", async () => {
  await originalModule.draftsRestored;
  composerDrafts.set({});
  const attachment: ComposerDraft["attachments"][number] = {
    key: "pending", name: "photo.png", mime: "image/png", size: 7, uri: "file://pending", state: "uploading",
  };
  const unsent: ComposerDraft = { text: "half-typed draft", attachments: [attachment] };
  const writesBeforeEdit = storageWrites.length;
  updateComposerDraft("active-chat", unsent, draft => draft);
  updateComposerDraft("second-chat", { text: "other unsent text", attachments: [] }, draft => draft);
  // Nothing has been persisted yet; Fast Refresh must preserve the live snapshot.
  expect(storageWrites).toHaveLength(writesBeforeEdit);

  // The query yields another evaluated module instance, just like Metro replacing a module.
  const hotUrl = new URL("./composer-drafts.ts?fast-refresh-307", import.meta.url).href;
  const refreshed: typeof import("./composer-drafts") = await import(hotUrl);
  expect(refreshed).not.toBe(originalModule);
  await refreshed.draftsRestored;
  expect(refreshed.composerDrafts).toBe(composerDrafts);
  expect(refreshed.draftsRestored).toBe(originalModule.draftsRestored);
  expect(refreshed.composerDrafts.get()["active-chat"]).toEqual(unsent);
  expect(refreshed.composerDrafts.get()["second-chat"]?.text).toBe("other unsent text");

  // A newly mounted composer supplies an empty seed, but must see its original draft.
  refreshed.updateComposerDraft("active-chat", { text: "", attachments: [] }, draft => draft);
  expect(refreshed.composerDrafts.get()["active-chat"]).toEqual(unsent);
  refreshed.updateComposerDraft("active-chat", { text: "", attachments: [] }, draft => ({
    ...draft, text: draft.text + " continued",
  }));
  expect(composerDrafts.get()["active-chat"]?.text).toBe("half-typed draft continued");

  // One storage reader and one app-state subscriber survive module replacement.
  expect(storageReads).toBe(1);
  expect(appStateListeners.size).toBe(1);
  const writesBeforeBackground = storageWrites.length;
  for (const listener of appStateListeners) listener("background");
  await Promise.resolve();
  await Promise.resolve();
  expect(storageWrites).toHaveLength(writesBeforeBackground + 1);
  const latestWrite = storageWrites.at(-1);
  if (!latestWrite) throw new Error("Background flush did not persist the refreshed draft");
  expect(JSON.parse(latestWrite)).toMatchObject({
    "active-chat": { text: "half-typed draft continued" },
    "second-chat": { text: "other unsent text" },
  });
  expect(latestWrite).not.toContain("attachments");
  expect(latestWrite).not.toContain("file://pending");
});
