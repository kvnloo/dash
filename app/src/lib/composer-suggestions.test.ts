import { describe, expect, test } from "bun:test";
import { composerSuggestions, composerTrigger, insertSuggestion } from "./composer-suggestions";
import { parseSuggestionInventory } from "../../../shared/suggestions";

describe("shared composer suggestions", () => {
  test("bare prefixes and mid-message mentions trigger; paths and prose slashes do not", () => {
    expect(composerTrigger("/")?.prefix).toBe("/");
    expect(composerTrigger("@")?.prefix).toBe("@");
    expect(composerTrigger("read @App")?.query).toBe("app");
    expect(composerTrigger("@app/App")?.query).toBe("app/app");
    expect(composerTrigger("/tmp/file")).toBeNull();
    expect(composerTrigger("read /tmp")).toBeNull();
    expect(composerTrigger("https://host/path")).toBeNull();
    expect(composerTrigger("/help ")).toBeNull();
  });
  test("cursor replacement preserves the rest of the draft", () => {
    const text = "Read @App then explain";
    const trigger = composerTrigger(text, 9);
    expect(trigger).not.toBeNull();
    if (trigger) expect(insertSuggestion(text, trigger, "@app/App.tsx")).toBe("Read @app/App.tsx then explain");
  });
  test("commands come only from the requested harness inventory, never scope placeholders", () => {
    const trigger = composerTrigger("/");
    if (!trigger) throw new Error("missing trigger");
    expect(composerSuggestions(trigger, { commands: [{ name: "compress", description: "Hermes context" }], files: [] }, [], []).map(row => row.label)).toEqual(["/compress"]);
  });
  test("files come from the bridge, with prefix matching", () => {
    const trigger = composerTrigger("@app");
    if (!trigger) throw new Error("missing trigger");
    expect(composerSuggestions(trigger, { commands: [], files: ["app/App.tsx", "bridge/index.ts"] }, [], []).map(row => row.insert)).toEqual(["@app/App.tsx"]);
  });
  test("malformed inventories fail rather than looking like an empty source", () => {
    expect(() => parseSuggestionInventory({})).toThrow();
    expect(parseSuggestionInventory({ commands: [{ name: "bad command", description: "no" }, { name: "help", description: "Help" }], files: ["app/App.tsx", 9] })).toEqual({ commands: [{ name: "help", description: "Help" }], files: ["app/App.tsx"], commandError: undefined, fileError: undefined });
  });
});
