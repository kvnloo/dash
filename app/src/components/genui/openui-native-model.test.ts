import { expect, test } from "bun:test";
import { clampProgress, layoutModel } from "./openui-native-model";
import type { OpenUINode } from "./openui-native-model";

test("every catalog kind has a stable, unique path and a spoken label", () => {
  const tree: OpenUINode = {
    type: "Stack",
    children: [{
      type: "Card", title: "Overview", children: [
        { type: "Text", value: "A plain description", tone: "muted" },
        { type: "Stat", label: "Active runs", value: 42 },
        { type: "Progress", label: "Complete", value: 0.5 },
        { type: "List", items: ["one", "two"] },
        { type: "Table", columns: ["Name", "Result"], rows: [["unit", "pass"]] },
        { type: "Callout", tone: "warning", text: "Review needed" },
        { type: "Roadmap", handle: "dash-roadmap" },
      ],
    }],
  };
  const rows = layoutModel(tree);

  expect(rows.map(row => row.type)).toEqual([
    "Stack", "Card", "Text", "Stat", "Progress", "List", "Table", "Callout", "Roadmap",
  ]);
  expect(rows.map(row => row.key)).toEqual([
    "root", "root/0", "root/0/0", "root/0/1", "root/0/2",
    "root/0/3", "root/0/4", "root/0/5", "root/0/6",
  ]);
  expect(new Set(rows.map(row => row.key)).size).toBe(rows.length);
  expect(rows.map(row => row.parentKey)).toEqual([
    null, "root", "root/0", "root/0", "root/0",
    "root/0", "root/0", "root/0", "root/0",
  ]);
  expect(rows.map(row => row.accessibilityLabel)).toEqual([
    "Group",
    "Overview, card",
    "A plain description",
    "Active runs: 42",
    "Complete, 50 percent",
    "List, 2 items",
    "Table, 2 columns, 1 row",
    "warning callout: Review needed",
    "Roadmap",
  ]);
  expect(rows.map(row => row.depth)).toEqual([0, 1, 2, 2, 2, 2, 2, 2, 2]);
  expect(layoutModel(tree)).toEqual(rows);
});

test("progress clamps -1, 0.5, 2 and refuses non-finite values", () => {
  const tree: OpenUINode = { type: "Stack", children: [
    { type: "Progress", label: "low", value: -1 },
    { type: "Progress", label: "half", value: 0.5 },
    { type: "Progress", label: "high", value: 2 },
    { type: "Progress", label: "missing", value: Number.NaN },
  ] };
  const progress = layoutModel(tree).flatMap(row => row.type === "Progress"
    ? [{ key: row.key, value: row.value, spoken: row.accessibilityLabel }]
    : []);
  expect(progress).toEqual([
    { key: "root/0", value: 0, spoken: "low, 0 percent" },
    { key: "root/1", value: 0.5, spoken: "half, 50 percent" },
    { key: "root/2", value: 1, spoken: "high, 100 percent" },
    { key: "root/3", value: 0, spoken: "missing, 0 percent" },
  ]);
  expect(clampProgress(Number.POSITIVE_INFINITY)).toBe(0);
  expect(clampProgress(0.166)).toBe(0.166);
});

test("deep flattening retains left-to-right preorder without losing siblings", () => {
  let nested: OpenUINode = { type: "Text", value: "leaf" };
  for (let i = 0; i < 8; i++) {
    nested = { type: "Stack", children: [{ type: "Text", value: `side-${i}` }, nested] };
  }
  const rows = layoutModel(nested);
  expect(rows.filter(row => row.type === "Text").map(row => row.accessibilityLabel)).toEqual([
    "side-7", "side-6", "side-5", "side-4", "side-3", "side-2", "side-1", "side-0", "leaf",
  ]);
  expect(rows).toHaveLength(17);
  expect(rows.at(-1)?.key).toBe("root/1/1/1/1/1/1/1/1");
  expect(rows.at(-1)?.depth).toBe(8);
  expect(layoutModel(nested).map(row => row.key)).toEqual(rows.map(row => row.key));
});

test("table strings and dangerous-looking text are data, not code or network requests", () => {
  const tree: OpenUINode = { type: "Card", title: "Results", children: [
    { type: "Text", value: "<script>fetch('https://invalid.example')</script>" },
    { type: "Table", columns: ["A", "B"], rows: [["<img src=x>", "one"], ["two", "three"]] },
    { type: "Stat", label: "Cost", value: "$12" },
  ] };
  const rows = layoutModel(tree);
  expect(rows[1]?.accessibilityLabel).toBe("<script>fetch('https://invalid.example')</script>");
  expect(rows[2]?.type).toBe("Table");
  const table = rows[2];
  if (table?.type !== "Table") throw new Error("Missing table row");
  expect(table.columns).toEqual(["A", "B"]);
  expect(table.rows).toEqual([["<img src=x>", "one"], ["two", "three"]]);
  expect(rows[3]?.accessibilityLabel).toBe("Cost: $12");
});

test("text updates preserve positional identity, while siblings remain distinct", () => {
  const first: OpenUINode = { type: "Stack", children: [
    { type: "Text", value: "draft" },
    { type: "Text", value: "second" },
  ] };
  const edited: OpenUINode = { type: "Stack", children: [
    { type: "Text", value: "published" },
    { type: "Text", value: "second" },
  ] };
  const oldRows = layoutModel(first);
  const newRows = layoutModel(edited);
  expect(oldRows.map(row => row.key)).toEqual(newRows.map(row => row.key));
  expect(oldRows[1]?.accessibilityLabel).toBe("draft");
  expect(newRows[1]?.accessibilityLabel).toBe("published");
  expect(newRows[1]?.key).not.toBe(newRows[2]?.key);
});
