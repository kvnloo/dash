import { expect, test } from "bun:test";
import { evidenceCoverage, ROADMAP, type RoadmapCheck } from "./roadmap-evidence";

test("historical scope is preserved as asks, never arbitrary feature percentages", () => {
  expect(ROADMAP).toHaveLength(29);
  expect(new Set(ROADMAP.map(item => item.id)).size).toBe(29);
  expect(ROADMAP.every(item => item.ask && item.checks.length === 4)).toBe(true);
  expect(ROADMAP.filter(item => evidenceCoverage(item.checks).verified > 0).map(item => item.id)).toEqual(["queued", "completion", "orchestra", "context", "annotation"]);
  expect(ROADMAP.find(item => item.id === "density")?.checks.every(check => check.status === "unknown")).toBe(true);
});
test("only verified checks carrying an exact revision and receipt advance evidence coverage", () => {
  const checks: RoadmapCheck[] = [
    { id: "x", label: "No receipt", status: "verified" },
    { id: "y", label: "Failed", status: "failed", receipt: { revision: "abc", url: "https://example.com", label: "failure" } },
    { id: "z", label: "Passed", status: "verified", receipt: { revision: "abc", url: "https://example.com", label: "pass" } },
  ];
  expect(evidenceCoverage(checks)).toEqual({ verified: 1, declared: 3, ratio: 1 / 3 });
  expect(evidenceCoverage([])).toEqual({ verified: 0, declared: 0, ratio: 0 });
});
