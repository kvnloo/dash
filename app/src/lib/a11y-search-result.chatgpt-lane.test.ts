import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SearchResult } from "./global-search";
import {
  performSearchResultAction,
  SEARCH_RESULT_KIND_LABEL,
  searchResultAccessibility,
} from "./a11y-search-result";

const unaddressableBot: Extract<SearchResult, { kind: "bot" }> = {
  kind: "bot",
  key: "bot:peer:writer",
  bot: { id: "writer", name: "Writer", runtime: "hermes", status: "running", channels: [] },
  hostName: "peer",
  subtitle: "peer · Telegram connected",
};

const target = {
  id: "hermes:writer",
  harness: "hermes",
  name: "Writer",
  role: "Agent",
  description: "Chat with Writer",
  online: true,
};
const reachableBot: Extract<SearchResult, { kind: "bot" }> = { ...unaddressableBot, target };

const offlineHarness: Extract<SearchResult, { kind: "harness" }> = {
  kind: "harness",
  key: "harness:claude",
  id: "claude",
  name: "Claude Code",
  available: false,
  subtitle: "Not installed on laptop",
};

const liveChat: Extract<SearchResult, { kind: "conversation" }> = {
  kind: "conversation",
  key: "conv:release",
  conversation: {
    id: "release",
    harness: "hermes",
    title: "Release notes",
    createdAt: 1,
    updatedAt: 10,
    messages: [{ id: "a1", role: "assistant", text: "Writing", state: "streaming", at: 10 }],
  },
  harnessName: "Hermes",
  subtitle: "Reviewing fixes",
};

const product: Extract<SearchResult, { kind: "product" }> = {
  kind: "product",
  key: "prod:dash",
  project: {
    id: "dash",
    name: "Dash",
    subtitle: "Phone agent",
    agents: [],
    chatIds: [],
    status: "idle",
    updatedAt: 10,
    topologyId: "mesh",
    providerId: "unknown",
  },
  subtitle: "Phone agent",
};

function announce(item: SearchResult, title: string, meta: string | null, hasLongPress = false) {
  return searchResultAccessibility(item, { title, meta, hasLongPress });
}

describe("SearchResultRow accessible metadata", () => {
  test("all supported result kinds have distinct spoken type names", () => {
    expect(Object.keys(SEARCH_RESULT_KIND_LABEL).sort()).toEqual([
      "bot", "conversation", "file", "harness", "plugin", "product", "skill", "tool",
    ]);
    const resource = { id: "read", name: "Read", description: "Read workspace" };
    const file: SearchResult = {
      kind: "file", key: "file:readme", file: { id: "readme", path: "README.md", description: "Setup" }, subtitle: "Setup",
    };
    const rows: { item: SearchResult; title: string; label: string; hint: string }[] = [
      { item: product, title: "Dash", label: "Dash, Product, Phone agent", hint: "Opens orchestra details" },
      { item: { kind: "skill", key: "skill:read", skill: resource, subtitle: "Read workspace" }, title: "Read",
        label: "Read, Skill, Read workspace", hint: "Opens OMP with a prefilled skill request" },
      { item: { kind: "plugin", key: "plugin:read", plugin: resource, subtitle: "Read workspace" }, title: "Read",
        label: "Read, Plugin, Read workspace", hint: "Opens OMP with a prefilled plugin request" },
      { item: { kind: "tool", key: "tool:read", tool: resource, subtitle: "Read workspace" }, title: "Read",
        label: "Read, Tool, Read workspace", hint: "Opens OMP with a prefilled tool request" },
      { item: file, title: "README.md", label: "README.md, File, Setup", hint: "Opens OMP with a prefilled file request" },
    ];
    for (const { item, title, label, hint } of rows) {
      const result = announce(item, title, null);
      expect(result.label).toBe(label);
      expect(result.hint).toBe(hint);
      expect(result.state).toEqual({ disabled: false });
      expect(result.actions).toEqual([{ name: "activate", label: "Open result" }]);
    }
  });

  test("bots without an addressable chat announce the limitation but remain actionable for details", () => {
    const result = announce(unaddressableBot, "Writer", "Running");
    expect(result.label).toBe("Writer, Bot, Running, Chat unavailable in Dash, peer · Telegram connected");
    expect(result.hint).toBe("Shows bot information; Dash cannot open its chat");
    expect(result.state).toEqual({ disabled: false });
  });

  test("reachable and offline bot targets are distinguished; feedback exists only when offered", () => {
    const online = announce(reachableBot, "Writer", "Running", true);
    expect(online.label).toBe("Writer, Bot, Running, Chat target online, peer · Telegram connected");
    expect(online.hint).toBe("Opens the bot chat");
    expect(online.actions).toEqual([
      { name: "activate", label: "Open result" },
      { name: "longpress", label: "Send feedback" },
    ]);
    const offline = announce({ ...reachableBot, target: { ...target, online: false } }, "Writer", "Running");
    expect(offline.label).toContain("Chat target offline");
    expect(offline.hint).toBe("Attempts to open the bot chat; its target is offline");
    expect(offline.actions).toEqual([{ name: "activate", label: "Open result" }]);
  });

  test("an unavailable harness is still selectable, with truthful status rather than a disabled fiction", () => {
    const result = announce(offlineHarness, "Claude Code", "Unavailable");
    expect(result).toEqual({
      label: "Claude Code, Harness, Unavailable, Not installed on laptop",
      hint: "Opens the chat view; this harness is unavailable",
      state: { disabled: false },
      actions: [{ name: "activate", label: "Open result" }],
    });
    const available = announce({ ...offlineHarness, available: true, subtitle: "Available on bridge" }, "Claude Code", "Available");
    expect(available.label).toBe("Claude Code, Harness, Available, Available on bridge");
    expect(available.hint).toBe("Opens a harness chat");
  });

  test("ended chats announce ended; streaming replies do not falsely make the row busy or selected", () => {
    const ended = announce({ ...liveChat, conversation: { ...liveChat.conversation, stale: true } }, "Release notes", "ended");
    expect(ended.label).toBe("Release notes, Chat, Ended, Reviewing fixes");
    expect(ended.hint).toBe("Opens the conversation");
    expect(ended.state).toEqual({ disabled: false });
    const streaming = announce(liveChat, "Release notes", "1m");
    expect(streaming.label).toBe("Release notes, Chat, Updated 1 minute ago, Reviewing fixes");
    expect(streaming.state).toEqual({ disabled: false });
    expect(streaming.actions).toHaveLength(1);
  });

  test("short relative timestamps are spoken as time, and missing titles do not become silent rows", () => {
    expect(announce(product, "Dash", "now").label).toBe("Dash, Product, Updated just now, Phone agent");
    expect(announce(product, "Dash", "2h").label).toContain("Updated 2 hours ago");
    expect(announce(product, "Dash", "3d").label).toContain("Updated 3 days ago");
    expect(announce(product, "Dash", "Oct 25").label).toContain("Updated Oct 25");
    const unnamed: SearchResult = {
      kind: "file", key: "file:missing", file: { id: "missing", path: "", description: "" }, subtitle: "",
    };
    expect(announce(unnamed, "", null).label).toBe("Unnamed file, File");
  });
});

describe("touch and accessibility action parity", () => {
  test("activate and longpress deliver the exact same result object to the original callbacks", () => {
    const pressed: SearchResult[] = [];
    const longPressed: SearchResult[] = [];
    const onPress = (item: SearchResult) => { pressed.push(item); };
    const onLongPress = (item: SearchResult) => { longPressed.push(item); };
    expect(performSearchResultAction(unaddressableBot, "activate", onPress, onLongPress)).toBe(true);
    expect(performSearchResultAction(unaddressableBot, "activate", onPress, onLongPress)).toBe(true);
    expect(performSearchResultAction(unaddressableBot, "longpress", onPress, onLongPress)).toBe(true);
    expect(pressed).toHaveLength(2);
    expect(pressed[0]).toBe(unaddressableBot);
    expect(pressed[1]).toBe(unaddressableBot);
    expect(longPressed).toEqual([unaddressableBot]);
    expect(longPressed[0]).toBe(unaddressableBot);
  });

  test("unsupported actions and unavailable feedback fail closed without selecting another target", () => {
    const pressed: SearchResult[] = [];
    const onPress = (item: SearchResult) => { pressed.push(item); };
    expect(performSearchResultAction(offlineHarness, "longpress", onPress)).toBe(false);
    expect(performSearchResultAction(offlineHarness, "custom", onPress)).toBe(false);
    expect(pressed).toEqual([]);
    expect(performSearchResultAction(offlineHarness, "activate", onPress)).toBe(true);
    expect(pressed[0]).toBe(offlineHarness);
  });

  test("owned component wires the same dispatcher for touch, accessible activate and feedback", () => {
    const source = readFileSync(join(import.meta.dir, "../components/SearchResultRow.tsx"), "utf8");
    expect(source).toContain('onPress={() => { performSearchResultAction(item, "activate", onPress, onLongPress); }}');
    expect(source).toContain('onLongPress={onLongPress ? () => { performSearchResultAction(item, "longpress", onPress, onLongPress); } : undefined}');
    expect(source).toContain("performSearchResultAction(item, event.nativeEvent.actionName, onPress, onLongPress)");
    expect(source).toContain("hasLongPress: onLongPress !== undefined");
    expect(source).toContain("accessibilityActions={a11y.actions}");
    expect(source).toContain("accessibilityLabel={a11y.label}");
    expect(source).toContain("accessibilityHint={a11y.hint}");
    expect(source).toContain("accessibilityState={a11y.state}");
    expect(source).toContain('accessibilityRole="button"');
    expect(source).toContain("accessible\n      focusable");
    expect(source).toContain("minHeight: 44");
    expect(source).toContain("numberOfLines={1}");
    expect(source).not.toContain("allowFontScaling={false}");
  });
});
