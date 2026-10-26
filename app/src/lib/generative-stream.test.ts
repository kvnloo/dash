import { describe, expect, test } from "bun:test";
import { generationState } from "./generation-state";
import { prepareGenerativeMarkdown } from "./generative-stream";
import { parseGenUI } from "./genui";
import { parseRoadmapLang } from "./openui-roadmap";

const pending = '{"__dash_pending_generated_ui__":true}';
const fencedPending = (language: string): string =>
  "```" + language + "\n" + pending + "\n```";

const json = JSON.stringify({
  version: 1,
  components: [{ type: "card", title: "Native roadmap", text: "Approved snapshot" }],
});
const lang = 'root = Roadmap("dash-roadmap")';

test("flow HTML fragments are buffered before the native Markdown parser sees them", () => {
  expect(prepareGenerativeMarkdown("```html\n<div>SENTINEL_RAW_SOURCE", true)).toBe(fencedPending("html"));
  expect(prepareGenerativeMarkdown("```ht", true)).toBe(fencedPending("html"));
  expect(prepareGenerativeMarkdown("```html\n<p>done</p>\n```", true)).toBe("```html\n<p>done</p>\n```");
});

describe("streaming native UI fence protection", () => {
  const examples: [string, string][] = [
    ["genui", json],
    ["openui", json],
    ["openui-lang", lang],
  ];
  for (const [language, source] of examples) {
    test(language + " keeps every unfinished source prefix behind a loader", () => {
      const prefix = "Prose above the UI.\n\n";
      for (let length = 0; length <= source.length; length++) {
        const incomplete = prefix + "```" + language + "\n" + source.slice(0, length);
        expect(prepareGenerativeMarkdown(incomplete)).toBe(prefix + fencedPending(language));
      }
      // Even fully valid source must wait for the closing fence.
      const complete = prefix + "```" + language + "\n" + source + "\n```";
      expect(prepareGenerativeMarkdown(complete)).toBe(complete);
    });
  }

  test("an unfinished language tag is normalized into a native pending UI block", () => {
    const prefixes: [string, string][] = [
      ["```g", "genui"],
      ["```ge", "genui"],
      ["```gen", "genui"],
      ["```o", "openui-lang"],
      ["```open", "openui-lang"],
      ["```openui", "openui"],
      ["```openui-l", "openui-lang"],
      ["```openui-lang", "openui-lang"],
    ];
    for (const [partial, full] of prefixes) {
      expect(prepareGenerativeMarkdown(partial)).toBe(fencedPending(full));
    }
  });

  test("the placeholder uses existing accessible loading and explicit error states", () => {
    const jsonPending = prepareGenerativeMarkdown("```genui\n" + json);
    expect(jsonPending).toBe(fencedPending("genui"));
    expect(parseGenUI(pending)).toBeNull();
    expect(generationState("genui", true, parseGenUI(pending) !== null)).toBe("loading");
    expect(generationState("genui", false, parseGenUI(pending) !== null)).toBe("invalid");
    expect(parseRoadmapLang(pending, false)).toBe("loading");
    expect(parseRoadmapLang(pending, true)).toBe("invalid");
    expect(parseRoadmapLang(lang, true)).toBe("ready");
    expect(parseGenUI(json)).not.toBeNull();
  });

  test("fenced invalid final UI passes through to existing invalid-state handling", () => {
    const invalid = "```genui\n{\"version\":1,\"components\":[{}\n```";
    expect(prepareGenerativeMarkdown(invalid)).toBe(invalid);
    expect(generationState("genui", false, parseGenUI('{"version":1,"components":[{}') !== null)).toBe("invalid");
  });

  test("preserves other fenced languages, indented examples and literal text", () => {
    const inputs = [
      "Normal prose, then ```genui inside the same line.",
      "    ```openui-lang\n" + lang,
      "> ```genui\n{broken}",
      "```ts\nconst hint = '```genui';\n```",
      "```openapi\nfoo",
      "```markdown\n```openui\n{partial}",
      "````markdown\n```\n```genui\n{partial}",
      "```mermaid\nflowchart LR\nA-->B",
      "```html\n<div>Hello</div>",
      "```genui\n{}\n```\nTrailing plain text",
    ];
    for (const source of inputs) expect(prepareGenerativeMarkdown(source)).toBe(source);
  });

  test("only the last unclosed UI fence is masked, retaining previous reply segments", () => {
    const first = "Before\n\n```genui\n" + json + "\n```\n\nMore\n\n";
    const second = "```openui-lang\n" + lang.slice(0, 12);
    expect(prepareGenerativeMarkdown(first + second)).toBe(first + fencedPending("openui-lang"));
  });

  test("honors fence widths, marker kinds, indentation and CRLF prose", () => {
    expect(prepareGenerativeMarkdown("  ~~~~openui\n" + json))
      .toBe("  ~~~~openui\n" + pending + "\n  ~~~~");
    expect(prepareGenerativeMarkdown("````genui\r\n" + json))
      .toBe("````genui\n" + pending + "\n````");
    const complete = "````genui\n" + json + "\n````";
    expect(prepareGenerativeMarkdown(complete)).toBe(complete);
    const prose = "Lead\r\n\r\n```openui\n" + json;
    expect(prepareGenerativeMarkdown(prose)).toBe("Lead\r\n\r\n" + fencedPending("openui"));
  });

  test("a shorter fence inside a longer unrelated code block never starts generated UI", () => {
    const source = "````typescript\n```genui\n" + json + "\n```\n````";
    expect(prepareGenerativeMarkdown(source)).toBe(source);
  });
});
