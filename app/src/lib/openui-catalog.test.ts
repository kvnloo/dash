import { describe, expect, test } from "bun:test";
import { parseOpenUI, type OpenUINode } from "./openui-catalog";

function ready(source: string): OpenUINode {
  const result = parseOpenUI(source, true);
  expect(result.state).toBe("ready");
  if (result.state !== "ready") throw new Error("Expected ready OpenUI: " + source.slice(0, 120));
  return result.tree;
}
function rejects(source: string): void {
  const result = parseOpenUI(source, true);
  expect(result.state).toBe("invalid");
  if (result.state === "invalid") expect(result.reason.length).toBeGreaterThan(0);
}
function nested(depth: number): string {
  let node = 'Text("leaf")';
  for (let i = 1; i < depth; i++) node = "Stack([" + node + "])";
  return "root = " + node;
}
function textChildren(count: number): string {
  return "root = Stack([" + Array.from({ length: count }, () => 'Text("x")').join(",") + "])";
}
function tableRows(count: number): string {
  return "root = Table([" + '"Name"' + "], [" + Array.from({ length: count }, (_, i) => '["row' + i + '"]').join(",") + "])";
}

describe("bounded OpenUI static catalog", () => {
  test("parses all nine components to typed, literal-only nodes", () => {
    expect(ready('root = Text("Hello", "muted")')).toEqual({ type: "Text", value: "Hello", tone: "muted" });
    expect(ready('root = Text("Hello")')).toEqual({ type: "Text", value: "Hello" });
    expect(ready('root = Stat("Users", 42)')).toEqual({ type: "Stat", label: "Users", value: 42 });
    expect(ready('root = Stat("Users", "42")')).toEqual({ type: "Stat", label: "Users", value: "42" });
    expect(ready('root = Progress("Done", 0.5)')).toEqual({ type: "Progress", label: "Done", value: 0.5 });
    expect(ready('root = List(["one", "two"])')).toEqual({ type: "List", items: ["one", "two"] });
    expect(ready('root = Table(["Name", "Status"], [["Dash", "ready"], ["Hermes", "waiting"]])'))
      .toEqual({ type: "Table", columns: ["Name", "Status"], rows: [["Dash", "ready"], ["Hermes", "waiting"]] });
    expect(ready('root = Callout("warning", "Review needed")'))
      .toEqual({ type: "Callout", tone: "warning", text: "Review needed" });
    expect(ready('root = Card("Summary", [Text("inside")])'))
      .toEqual({ type: "Card", title: "Summary", children: [{ type: "Text", value: "inside" }] });
    expect(ready('root = Stack([Text("top"), Card("Detail", [Stat("Count", 3)])])'))
      .toEqual({
        type: "Stack",
        children: [
          { type: "Text", value: "top" },
          { type: "Card", title: "Detail", children: [{ type: "Stat", label: "Count", value: 3 }] },
        ],
      });
    expect(ready('root = Roadmap("dash-roadmap")')).toEqual({ type: "Roadmap", handle: "dash-roadmap" });
  });

  test("resolves named forward refs but rejects unused statements", () => {
    expect(ready([
      "root = Stack([heading, details])",
      'details = Card("Results", [metric])',
      'metric = Progress("Compiled", 1)',
      'heading = Text("Ready")',
    ].join("\n"))).toEqual({
      type: "Stack",
      children: [
        { type: "Text", value: "Ready" },
        { type: "Card", title: "Results", children: [{ type: "Progress", label: "Compiled", value: 1 }] },
      ],
    });
    rejects('root = Text("ok")\nunused = Text("ignored")');
  });

  test("preserves only the exact approved Roadmap source and handle", () => {
    expect(ready(' \n root = Roadmap("dash-roadmap") ; \n')).toEqual({ type: "Roadmap", handle: "dash-roadmap" });
    for (const source of [
      'root = Roadmap("different")',
      'root = Roadmap("dash-roadmap", "extra")',
      'root = Roadmap("dash-roadmap")\nextra = Text("x")',
      'root = Stack([Roadmap("dash-roadmap")])',
      'approved = Roadmap("dash-roadmap")\nroot = approved',
      'root = Roadmap("\\u0064ash-roadmap")',
    ]) rejects(source);
  });

  test("streaming is never exposed as a ready partial tree", () => {
    const source = 'root = Stack([Text("Hello"), Card("Soon", [Stat("n", 1)])])';
    for (let i = 0; i <= source.length; i++) {
      expect(parseOpenUI(source.slice(0, i), false)).toEqual({ state: "loading" });
    }
    expect(parseOpenUI('root = Text("unfinished', false)).toEqual({ state: "loading" });
    rejects('root = Text("unfinished');
  });

  test("rejects tools, state, actions, expressions and recoverable garbage", () => {
    for (const source of [
      'data = Query("getPrivateData")\nroot = Text("okay")',
      'result = Mutation("write")\nroot = Text("okay")',
      '$count = 1\nroot = Stat("count", $count)',
      'root = Text(@Count([1, 2]))',
      'root = Callout("info", @Run("command"))',
      'root = Text("a" + "b")',
      'root = Text($state)',
      'root = Text("safe") // injected comment',
      'root = Text("safe") # ignored',
      'root = Text("safe") extra',
      'root = Text("safe"); garbage',
      'root = Text({"value":"unsafe"})',
      'root = Button("action")',
      'root = Widget("unknown")',
      'root = Stack([Unknown("nested")])',
      'root = Text("x")\nroot = Text("override")',
      'root = Stack([missing])',
      'root = Text("okay")\nother = ghost',
      'thing = Text("missing root")',
      'root = Stack([Text("bad")',
    ]) rejects(source);
  });

  test("rejects wrong props, extra args, arrays and non-finite/range-invalid progress", () => {
    for (const source of [
      "root = Text()",
      'root = Text(23)',
      'root = Text("value", "tone", "extra")',
      'root = Stat(42, "value")',
      'root = Stat("v", true)',
      'root = Progress("bad", -0.01)',
      'root = Progress("bad", 1.01)',
      'root = Progress("bad", "0.5")',
      'root = Progress("bad", 1e309)',
      'root = List("not an array")',
      'root = List(["good", 42])',
      'root = Stack(["literal child"])',
      'root = Card("label", ["literal child"])',
      'root = Table([], [])',
      'root = Table(["Name", "Status"], [["too short"]])',
      'root = Table(["Name"], [[42]])',
      'root = Callout(0, "text")',
      'root = Callout("warning", 123)',
    ]) rejects(source);
    expect(ready('root = Progress("start", 0)')).toEqual({ type: "Progress", label: "start", value: 0 });
    expect(ready('root = Progress("finish", 1)')).toEqual({ type: "Progress", label: "finish", value: 1 });
  });

  test("caps node count at 200 and nesting depth at 8", () => {
    expect(ready(textChildren(199)).type).toBe("Stack");
    rejects(textChildren(200));
    expect(ready(nested(8)).type).toBe("Stack");
    rejects(nested(9));
    rejects('root = Stack([root])');
  });

  test("caps strings, table rows, and UTF-8 source bytes", () => {
    expect(ready('root = Text("' + "a".repeat(2000) + '")').type).toBe("Text");
    rejects('root = Text("' + "a".repeat(2001) + '")');
    rejects('root = Table(["a"], [["' + "b".repeat(2001) + '"]])');
    expect(ready(tableRows(50)).type).toBe("Table");
    rejects(tableRows(51));
    const utf8Oversize = "root = Stack([" + Array.from({ length: 100 }, () => 'Text("' + "😀".repeat(60) + '")').join(",") + "])";
    const capped = parseOpenUI(utf8Oversize, true);
    expect(capped).toEqual({ state: "invalid", reason: "Source exceeds 16 KiB" });
    expect(parseOpenUI("x".repeat(16385), false)).toEqual({ state: "invalid", reason: "Source exceeds 16 KiB" });
  });
});
