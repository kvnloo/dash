import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ComposerDraft } from "../store/composer-drafts";

// Bun keeps a file-level react-native mock for the rest of the run and later
// suites link named imports against its export list, so expose every native
// boundary later suites import (Platform, PermissionsAndroid), not only AppState.
mock.module("react-native", () => ({
  Platform: { OS: "web" },
  PermissionsAndroid: { PERMISSIONS: {}, RESULTS: { GRANTED: "granted" }, request: async () => "granted" },
  AppState: { currentState: "active", addEventListener() { return { remove() {} }; } },
}));
mock.module("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => undefined },
}));

const { composerDrafts } = await import("../store/composer-drafts");
const { readableReplyText, selectedReplyText, appendReplyQuote, replyToSelection } = await import("./selection-quote");

describe("Normal-mode Reply to selection", () => {
  test("the selection buffer follows visible prose and preserves fenced code", () => {
    const input = ["# **Fixed** pairing", "", "[Read notes](https://example.com)", "", "```ts", "const user_name = 4;", "```", "", "> Looks good"].join("\n");
    expect(readableReplyText(input)).toBe("Fixed pairing\n\nRead notes\n\nconst user_name = 4;\n\nLooks good");
  });

  test("quotes precisely the selected UTF-16 range, not the whole message", () => {
    const source = "First 👍🏼 answer.\nSecond answer.";
    const start = source.indexOf("Second");
    const end = start + "Second answer".length;
    expect(selectedReplyText(source, { start, end })).toBe("Second answer");
    expect(appendReplyQuote("Already typing.", selectedReplyText(source, { start, end })))
      .toBe("Already typing.\n\n> Second answer\n\n");
    expect(appendReplyQuote("one line\n", "alpha\nbeta"))
      .toBe("one line\n\n> alpha\n> beta\n\n");
    expect(appendReplyQuote("", " hello \r\n world ")).toBe("> hello\n>  world\n\n");
  });

  test("keeps every existing draft attachment and isolates the target chat", () => {
    const attachment: ComposerDraft["attachments"][number] = { key: "one", name: "note.txt", mime: "text/plain", size: 2, uri: "file://note", state: "ready" };
    composerDrafts.set({
      "chat-one": { text: "Unsent", attachments: [attachment] },
      "chat-two": { text: "Other draft", attachments: [] },
    });
    const source = "A **quoted** word in a longer message";
    const text = readableReplyText(source);
    const start = text.indexOf("quoted");
    expect(replyToSelection("chat-one", text, { start, end: start + 6 })).toBe(true);
    expect(composerDrafts.get()["chat-one"]).toEqual({ text: "Unsent\n\n> quoted\n\n", attachments: [attachment] });
    expect(composerDrafts.get()["chat-two"]?.text).toBe("Other draft");
  });

  test("empty, invalid or canceled selections never mutate a draft", () => {
    composerDrafts.set({ active: { text: "Leave alone", attachments: [] } });
    const content = "some text";
    for (const range of [null, { start: 2, end: 2 }, { start: 5, end: 2 }, { start: -1, end: 2 }, { start: 0, end: 99 }, { start: 0.2, end: 3 }]) {
      expect(replyToSelection("active", content, range)).toBe(false);
    }
    expect(replyToSelection("active", "   ", { start: 0, end: 3 })).toBe(false);
    expect(replyToSelection(null, content, { start: 0, end: 4 })).toBe(false);
    expect(composerDrafts.get().active?.text).toBe("Leave alone");
  });

  test("Android UI only opens while not annotating, captures handles, and offers accessible 44dp actions", () => {
    const code = readFileSync(join(import.meta.dir, "Markdown.tsx"), "utf8");
    expect(code).toContain('Platform.OS !== "android" || annotate.get().active');
    expect(code).toContain("delayLongPress={350}");
    expect(code).toContain("selectTextOnFocus");
    expect(code).toContain("showSoftInputOnFocus={false}");
    expect(code).toContain("onSelectionChange={event => onSelection(event.nativeEvent.selection)}");
    expect(code).toContain('accessibilityLabel="Reply to selection"');
    expect(code).toContain("disabled={!canReply}");
    expect(code).toContain("minHeight: 44");
    expect(code).toContain('animationType="none"');
    expect(code).toContain("replyToSelection(pendingSelection.conversationId, pendingSelection.source, range)");
    expect(code).not.toContain("sendChat(");
    expect(code).not.toContain("onSend(");
  });
});
