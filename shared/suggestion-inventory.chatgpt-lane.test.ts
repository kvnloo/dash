import { describe, expect, test } from "bun:test";
import { parseCommands, parseSuggestionInventory } from "./suggestions";

describe("parseCommands: untrusted command advertisements", () => {
  test("non-array envelopes cannot invent command suggestions", () => {
    const malformed: unknown[] = [undefined, null, false, 0, "", "help", {}, { name: "help", description: "Help" }];
    for (const raw of malformed) expect(parseCommands(raw)).toEqual([]);
  });

  test("preserves valid command identity and description without leaking unknown fields", () => {
    const source = {
      name: "ReView_2-Now",
      description: "  Exact ACP label  ",
      sessionId: "session:CaseSensitive",
      targetId: "host:One",
      optionId: "allow_once",
      extra: { text: "not a command" },
    };
    expect(parseCommands([source])).toEqual([
      { name: "ReView_2-Now", description: "  Exact ACP label  " },
    ]);
  });

  test("skips non-record entries and incomplete or mistyped records, keeping the valid neighbor", () => {
    const good = { name: "help", description: "Advertised by harness" };
    const malformed: unknown[] = [
      undefined, null, false, 42, "help", [], ["help"], {},
      { name: "help" },
      { description: "Missing name" },
      { name: null, description: "No name" },
      { name: ["help"], description: "Array name" },
      { name: { value: "help" }, description: "Object name" },
      { name: "help", description: null },
      { name: "help", description: 5 },
      { name: "help", description: ["text"] },
      { name: "help", description: { text: "Help" } },
    ];
    expect(parseCommands([malformed[0], good, ...malformed.slice(1)])).toEqual([good]);
  });

  test("rejects malformed identifiers rather than trimming, lowercasing, or repairing them", () => {
    const invalidNames = [
      "", " ", " help", "help ", "/help", "@agent", "two words",
      "1help", "-help", "_help", "help/path", "help\\path",
      "help.name", "name\nother", "naïve", "help\u0000suffix",
    ];
    for (const name of invalidNames) {
      expect(parseCommands([{ name, description: "Valid description" }])).toEqual([]);
    }
    expect(parseCommands([{ name: "h_2-Help", description: "" }])).toEqual([
      { name: "h_2-Help", description: "" },
    ]);
  });

  test("rejects a missing or wrong-type description independently of a valid name", () => {
    for (const description of [undefined, null, false, 0, [], {}]) {
      expect(parseCommands([{ name: "help", description }])).toEqual([]);
    }
    expect(parseCommands([{ name: "help", description: "Help" }])).toEqual([
      { name: "help", description: "Help" },
    ]);
  });

  test("keeps the first duplicate command ID while retaining distinct case-sensitive IDs", () => {
    expect(parseCommands([
      { name: "ReView", description: "first" },
      { name: "ReView", description: "duplicate ID must not shadow first" },
      { name: "review", description: "distinct command ID" },
      { name: "ReView", description: "third duplicate" },
    ])).toEqual([
      { name: "ReView", description: "first" },
      { name: "review", description: "distinct command ID" },
    ]);
  });
});

describe("parseSuggestionInventory: untrusted bridge payloads", () => {
  test("rejects missing, non-record, and non-array containers instead of showing empty success", () => {
    const malformed: unknown[] = [
      undefined, null, false, 0, "", [], {}, { files: [] }, { commands: [] },
      { commands: null, files: [] }, { commands: [], files: null },
      { commands: {}, files: [] }, { commands: [], files: {} },
      { commands: "help", files: [] }, { commands: [], files: "app/README.md" },
    ];
    for (const raw of malformed) {
      expect(() => parseSuggestionInventory(raw)).toThrow("Invalid suggestion inventory from bridge.");
    }
  });

  test("accepts genuine empty inventory without synthesizing file, command, or identity state", () => {
    expect(parseSuggestionInventory({
      commands: [],
      files: [],
      targetId: "host:target",
      optionId: "allow",
      sessionId: "session:123",
      suggestions: [{ name: "invented", description: "Never advertise me" }],
      error: "not a command or file error",
    })).toEqual({
      commands: [],
      files: [],
      commandError: undefined,
      fileError: undefined,
    });
  });

  test("filters malformed elements independently without normalizing legitimate file names", () => {
    expect(parseSuggestionInventory({
      commands: [
        null,
        { name: "bad command", description: "invalid identifier" },
        { name: "ReView_9", description: "Exact ID" },
        { name: "help", description: {} },
      ],
      files: [
        null, 42, false, {}, ["app/src/Real File.tsx"],
        "app/src/Real File.tsx", "APP/src/Real File.tsx", " @literal path ",
      ],
    })).toEqual({
      commands: [{ name: "ReView_9", description: "Exact ID" }],
      files: ["app/src/Real File.tsx", "APP/src/Real File.tsx", " @literal path "],
      commandError: undefined,
      fileError: undefined,
    });
  });

  test("drops blank and duplicate file IDs but never rewrites distinct case-sensitive paths", () => {
    expect(parseSuggestionInventory({
      commands: [],
      files: [
        "src/Case.tsx", "src/Case.tsx", "", " ", "\t", "SRC/Case.tsx",
        " src/Space Name.tsx ", " src/Space Name.tsx ",
      ],
    })).toEqual({
      commands: [],
      files: ["src/Case.tsx", "SRC/Case.tsx", " src/Space Name.tsx "],
      commandError: undefined,
      fileError: undefined,
    });
  });

  test("command error is independent of successful files and does not create commands", () => {
    expect(parseSuggestionInventory({
      commands: [],
      files: ["docs/Read Me.md"],
      commandError: "ACP command catalog unavailable",
    })).toEqual({
      commands: [],
      files: ["docs/Read Me.md"],
      commandError: "ACP command catalog unavailable",
      fileError: undefined,
    });
  });

  test("file error is independent of valid commands and does not invent files", () => {
    expect(parseSuggestionInventory({
      commands: [{ name: "help", description: "Available" }],
      files: [],
      fileError: "Git workspace unavailable",
    })).toEqual({
      commands: [{ name: "help", description: "Available" }],
      files: [],
      commandError: undefined,
      fileError: "Git workspace unavailable",
    });
  });

  test("preserves two distinct source errors without hiding surviving entries", () => {
    expect(parseSuggestionInventory({
      commands: [{ name: "inspect", description: "Available" }],
      files: ["src/safe.ts"],
      commandError: "ACP down",
      fileError: "Git down",
    })).toEqual({
      commands: [{ name: "inspect", description: "Available" }],
      files: ["src/safe.ts"],
      commandError: "ACP down",
      fileError: "Git down",
    });
  });

  test("ignores unknown or wrong-type error metadata without converting it into strings", () => {
    for (const bad of [null, false, 0, {}, ["unavailable"]]) {
      expect(parseSuggestionInventory({
        commands: [],
        files: [],
        commandError: bad,
        fileError: bad,
      })).toEqual({
        commands: [],
        files: [],
        commandError: undefined,
        fileError: undefined,
      });
    }
  });

  test("does not mistake missing data plus an error for a valid empty inventory", () => {
    expect(() => parseSuggestionInventory({
      commandError: "command discovery failed",
      fileError: "file discovery failed",
    })).toThrow("Invalid suggestion inventory from bridge.");
  });
});
