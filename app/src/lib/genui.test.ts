import { expect, test } from "bun:test";
import { parseGenUI, sandboxHTML, isImageRef } from "./genui";
import { parseMermaid } from "./mermaid";
const spec = (components: unknown[]) => JSON.stringify({ version: 1, components });
test("complete data catalog parses, preserves display text without evaluating it", () => {
  const widgets = parseGenUI(spec([
    { type: "card", title: "Summary", children: [{ type: "stat", title: "Count", value: 3 }] },
    { type: "table", title: "Tests", columns: ["Name", "Result"], rows: [["UI", "pass"]] },
    { type: "progress", title: "Complete", value: 60 },
    ...["choices", "buttons", "checklist", "timeline"].map(type => ({ type, id: type, title: type, items: [{ id: "a", label: "<script>alert(1)</script>", checked: false }] })),
  ]));
  expect(widgets).toHaveLength(7);
  expect(widgets?.[3]?.items?.[0]?.label).toBe("<script>alert(1)</script>");
});
test("malformed, executable, oversize, deep, invalid IDs and ambiguous data fail closed", () => {
  for (const source of ["not json", "x".repeat(64001), spec([{ type: "iframe", title: "bad" }]), spec([{ type: "card", title: "bad", onClick: "eval()" }]), spec([{ type: "progress", title: "bad", value: 101 }]), spec([{ type: "choices", id: "a space", title: "bad", items: [] }]), spec([{ type: "table", title: "bad", columns: ["a"], rows: [["a", "b"]] }])]) expect(parseGenUI(source)).toBeNull();
  let tree: unknown = { type: "card", title: "leaf" };
  for (let i = 0; i < 8; i++) tree = { type: "card", title: "nested", children: [tree] };
  expect(parseGenUI(spec([tree]))).toBeNull();
  expect(parseGenUI(spec(Array(25).fill({ type: "stat", title: "many", value: 1 })))).toBeNull();
  expect(parseGenUI(spec([{ type: "choices", id: "pick", title: "Duplicate", items: [{ id: "a", label: "A" }, { id: "a", label: "B" }] }]))).toBeNull();
});
test("flowchart nodes, edge labels, direction and chains", () => {
  const d = parseMermaid('flowchart LR\nA[Agent] -->|reply| B{UI} --> C("Owner")');
  expect(d?.direction).toBe("LR"); expect(d?.nodes.map(n => n.label)).toEqual(["Agent", "UI", "Owner"]);
  expect(d?.edges).toEqual([{ id: "e0", source: "A", target: "B", label: "reply" }, { id: "e1", source: "B", target: "C" }]);
});
test("stateDiagram aliases, start/end and details", () => {
  const d = parseMermaid('stateDiagram-v2\n[*] --> Idle\nstate "Working agent" as Busy\nIdle --> Busy : send\nBusy : Running tools\nBusy --> [*]');
  expect(d?.nodes.find(n => n.id === "Busy")).toEqual({ id: "Busy", label: "Working agent", detail: "Running tools" });
  expect(d?.edges[1]?.label).toBe("send"); expect(d?.edges.at(-1)?.target).toBe("__end");
});
test("unsupported Mermaid remains code rather than silently dropping syntax", () => {
  for (const input of ['sequenceDiagram\nA->>B: hello', 'flowchart TD\nsubgraph hi\nA --> B\nend', 'stateDiagram-v2\nstate Busy {\nA --> B\n}', 'flowchart TD\nclick A "javascript:alert(1)"', 'flowchart TD\nA --> B\nstyle A color:red']) expect(parseMermaid(input)).toBeNull();
  expect(parseMermaid('flowchart TD\n' + Array.from({ length: 100 }, (_, i) => `n${i} --> n${i + 1}`).join('\n'))).toBeNull();
});
test("HTML policy precedes untrusted bytes, forbids scripts and network", () => {
  const doc = sandboxHTML('<script>fetch("https://example.com")</script>');
  expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("<script>"));
  expect(doc).toContain("script-src 'none'"); expect(doc).toContain("connect-src 'none'"); expect(doc).toContain("form-action 'none'");
});
test("image references reject active schemes, protocol-relative targets and SVG", () => {
  expect(isImageRef("https://example.com/a.png?x=1")).toBe(true); expect(isImageRef("/home/owner/a.webp")).toBe(true);
  for (const url of ["javascript:a.png", "file:///a.png", "//example.com/a.png", "/image.svg"]) expect(isImageRef(url)).toBe(false);
});
