import { describe, expect, test } from "bun:test";
import type { HostInfo } from "../../../shared/protocol";
import { parseSuggestionInventory, type SuggestionInventory } from "../../../shared/suggestions";
import type { Conversation } from "../model";
import {
  composerSuggestions,
  composerTrigger,
  insertSuggestion,
  type ComposerTrigger,
} from "./composer-suggestions";

const emptyInventory: SuggestionInventory = { commands: [], files: [] };

function requiredTrigger(text: string, cursor?: number): ComposerTrigger {
  const found = composerTrigger(text, cursor);
  if (!found) throw new Error("Expected a suggestion trigger in the synthetic draft");
  return found;
}

function conversation(id: string, title: string, sessionId?: string): Conversation {
  return {
    id,
    title,
    sessionId,
    harness: "hermes",
    createdAt: 1,
    updatedAt: 2,
    messages: [],
  };
}

function host(id: string, name: string): HostInfo {
  return {
    id,
    name,
    hostname: name.toLowerCase(),
    online: true,
    self: false,
    bots: [
      {
        id: "bot-shared",
        name: "Helper",
        runtime: "hermes",
        status: "running",
        channels: [],
      },
    ],
    agents: [
      { id: "agent-shared", name: "Helper", kind: "hermes", status: "running" },
    ],
  };
}

describe("composer cursor and trigger boundaries (production exports)", () => {
  test("cursor snapshots activate only the token before the caret", () => {
    const text = "draft @Team later /ignored";
    expect(composerTrigger(text, 0)).toBeNull();
    expect(composerTrigger(text, 6)).toBeNull();
    expect(composerTrigger(text, 7)).toEqual({
      prefix: "@", query: "", start: 6, end: 7,
    });
    expect(composerTrigger(text, 9)).toEqual({
      prefix: "@", query: "te", start: 6, end: 9,
    });
    expect(composerTrigger(text)).toBeNull();
    expect(composerTrigger("")).toBeNull();
  });

  test("UTF-16 offsets, newlines and leading whitespace do not shift replacements", () => {
    expect(composerTrigger("😀\n@NeW")).toEqual({
      prefix: "@", query: "new", start: 3, end: 7,
    });
    expect(composerTrigger("😀\n@NeW", 1)).toBeNull();
    expect(composerTrigger("\t /He")).toEqual({
      prefix: "/", query: "he", start: 2, end: 5,
    });
  });

  test("slash is leading-only; mentions accept paths but not email or nested @", () => {
    expect(composerTrigger("  /")).toEqual({
      prefix: "/", query: "", start: 2, end: 3,
    });
    expect(composerTrigger(" @src/Lib.ts")).toEqual({
      prefix: "@", query: "src/lib.ts", start: 1, end: 12,
    });
    for (const draft of [
      "/nested/path",
      "notes /help",
      "notes/@target",
      "person@example.com",
      " @one@two",
      "/help next",
      "@name ",
    ]) {
      expect(composerTrigger(draft)).toBeNull();
    }
    expect(composerTrigger("ask @")).toEqual({
      prefix: "@", query: "", start: 4, end: 5,
    });
  });

  test("insertion replaces only the current span and retains unrelated suffix text", () => {
    const draft = "🧪 @Tar   and continue";
    const cursor = "🧪 @Tar".length;
    expect(insertSuggestion(draft, requiredTrigger(draft, cursor), "@Session/Case:A"))
      .toBe("🧪 @Session/Case:A and continue");
    expect(insertSuggestion("/ex", requiredTrigger("/ex"), "/Execute")).toBe("/Execute ");
    expect(insertSuggestion("ask @", requiredTrigger("ask @"), "@target")).toBe("ask @target ");
  });

  test("out-of-bounds cursor cannot manufacture a trigger from truncated text", () => {
    const draft = "work @hi";
    for (const cursor of [-1, draft.length + 1, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(composerTrigger(draft, cursor)).toBeNull();
    }
  });

  test("invalid or reversed trigger spans are rejected instead of replacing arbitrary text", () => {
    const draft = "ask @target later";
    const invalid: ComposerTrigger[] = [
      { prefix: "@", query: "target", start: -1, end: 11 },
      { prefix: "@", query: "target", start: 11, end: 4 },
      { prefix: "@", query: "target", start: 4, end: draft.length + 1 },
      { prefix: "@", query: "target", start: Number.NaN, end: 11 },
    ];
    for (const trigger of invalid) {
      expect(() => insertSuggestion(draft, trigger, "@Session/Exact"))
        .toThrow(RangeError);
    }
  });
});

describe("composer suggestion inventory and identity boundaries", () => {
  test("missing, null, array, scalar and wrong-shaped bridge inventories reject", () => {
    const malformed: unknown[] = [
      undefined,
      null,
      [],
      0,
      "@",
      {},
      { commands: [], files: null },
      { commands: null, files: [] },
      { commands: {}, files: [] },
      { commands: [], files: {} },
    ];
    for (const input of malformed) {
      expect(() => parseSuggestionInventory(input))
        .toThrow("Invalid suggestion inventory from bridge.");
    }
  });

  test("invalid nested command/file types never become actionable rows", () => {
    const parsed = parseSuggestionInventory({
      commands: [
        null,
        [],
        { name: "9bad", description: "invalid name" },
        { name: "help", description: 44 },
        { name: "CaseSensitive", description: "Exact option" },
      ],
      files: [null, 7, [], { path: "fake.ts" }, "src/Valid.ts"],
    });
    expect(parsed).toEqual({
      commands: [{ name: "CaseSensitive", description: "Exact option" }],
      files: ["src/Valid.ts"],
      commandError: undefined,
      fileError: undefined,
    });
    expect(composerSuggestions(requiredTrigger("/case"), parsed, [], []))
      .toEqual([{
        id: "command:CaseSensitive",
        label: "/CaseSensitive",
        detail: "Exact option",
        insert: "/CaseSensitive",
      }]);
    expect(composerSuggestions(requiredTrigger("@valid"), parsed, [], []))
      .toEqual([]);
    expect(composerSuggestions(requiredTrigger("@src"), parsed, [], []))
      .toEqual([{
        id: "file:src/Valid.ts",
        label: "@src/Valid.ts",
        detail: "Workspace file",
        insert: "@src/Valid.ts",
      }]);
  });

  test("same display name on different hosts keeps distinct target and session identities", () => {
    const chats = [
      conversation("chat-A", "Same", "Native/Case:A"),
      conversation("chat-B", "Same"),
    ];
    const rows = composerSuggestions(
      requiredTrigger("@"), emptyInventory, chats,
      [host("host-A", "Laptop"), host("host-B", "Desktop")],
    );
    expect(rows.map(row => ({ id: row.id, insert: row.insert }))).toEqual([
      { id: "chat:chat-A", insert: "@Native/Case:A" },
      { id: "chat:chat-B", insert: "@chat-B" },
      { id: "bot:host-A:bot-shared", insert: "@Helper" },
      { id: "agent:host-A:agent-shared", insert: "@Helper" },
      { id: "bot:host-B:bot-shared", insert: "@Helper" },
      { id: "agent:host-B:agent-shared", insert: "@Helper" },
    ]);
    expect(composerSuggestions(
      requiredTrigger("@helper"), emptyInventory, [],
      [host("host-A", "Laptop"), host("host-B", "Desktop")],
    ).map(row => row.id)).toEqual([
      "bot:host-A:bot-shared",
      "agent:host-A:agent-shared",
      "bot:host-B:bot-shared",
      "agent:host-B:agent-shared",
    ]);
  });

  test("slash mode cannot leak chat/host/file targets; results cap at 30 in source order", () => {
    const commands = Array.from({ length: 35 }, (_, index) => ({
      name: "Run" + index,
      description: "Exact action " + index,
    }));
    const rows = composerSuggestions(
      requiredTrigger("/rUn"),
      { commands, files: ["src/should-not-show.ts"] },
      [conversation("chat-A", "Run target")],
      [host("host-A", "Laptop")],
    );
    expect(rows).toHaveLength(30);
    expect(rows[0]).toEqual({
      id: "command:Run0", label: "/Run0", detail: "Exact action 0", insert: "/Run0",
    });
    expect(rows[29]?.id).toBe("command:Run29");
    expect(rows.every(row => row.id.startsWith("command:"))).toBe(true);
  });

  test("an empty session id cannot become a bare @ target", () => {
    const rows = composerSuggestions(
      requiredTrigger("@"), emptyInventory, [conversation("chat-local", "Local", "")], [],
    );
    expect(rows.map(row => row.insert)).toEqual(["@chat-local"]);
  });

  test("invalid empty filenames cannot turn into invented @ targets", () => {
    const parsed = parseSuggestionInventory({
      commands: [],
      files: ["", " ", "src/Real.ts"],
    });
    expect(composerSuggestions(requiredTrigger("@"), parsed, [], [])
      .map(row => row.id)).toEqual(["file:src/Real.ts"]);
  });

  test("malformed trigger records never fall into mention mode", () => {
    const inputs: unknown[] = [
      null,
      [],
      { prefix: "!", query: "", start: 0, end: 1 },
      { prefix: "@", start: 0, end: 1 },
      { prefix: 9, query: "", start: 0, end: 1 },
    ];
    for (const raw of inputs) {
      expect(() => Reflect.apply(composerSuggestions, undefined, [
        raw, emptyInventory, [], [host("host-A", "Laptop")],
      ])).toThrow();
    }
  });
});
