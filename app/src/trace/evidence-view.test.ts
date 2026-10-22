import { expect, test } from "bun:test";
import type { TraceEvidence } from "../../../shared/trace-evidence";
import { byKind, goalLine } from "./evidence-view";

const evidence = (quote: string, goal: string): TraceEvidence => ({ quote, quoteRedacted: false, warnings: [], checks: [], artifacts: [], intent: { specVersion: "0.2", graphId: "g", revision: 0, intentGraph: { nodes: [{ id: "t", kind: "task", ports: [], capabilities: [] }], edges: [] }, policies: {}, constraints: { budgets: {}, termination: {}, goal, acceptance: [], rules: [] }, provenance: { sourceHash: "a".repeat(64), source: "/p" } } });

test("goal never repeats the request it was extracted from", () => {
  const ask = "one of the issues I want to fix is that the main input bar should be attached to an agent at all times";
  expect(goalLine(evidence(ask, `${ask.slice(0, 90)}…`))).toBe("Not stated separately · the request above is the goal");
  expect(goalLine(evidence(ask, ""))).toBe("Unknown · no goal stated");
  expect(goalLine(evidence(ask, "Keep the composer attached"))).toBe("Keep the composer attached");
  expect(goalLine(evidence("", "x".repeat(300)))).toBe(`${"x".repeat(240)}…`);
});

test("artifacts group by kind in review order and drop empty kinds", () => {
  const groups = byKind([
    { kind: "file", title: "REPORT.md", target: "/r/REPORT.md" },
    { kind: "image", title: "a.png", target: "/r/a.png" },
    { kind: "pr", title: "113", target: "https://github.com/kvnloo/dash/pull/113" },
    { kind: "image", title: "b.png", target: "/r/b.png" },
  ]);
  expect(groups.map(([k, g]) => [k, g.map(a => a.title)])).toEqual([["image", ["a.png", "b.png"]], ["pr", ["113"]], ["file", ["REPORT.md"]]]);
});
