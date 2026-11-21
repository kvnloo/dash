import { describe, expect, test } from "bun:test";
import { learnPrompt, nextPillMode, pillModeOf, quickItems, unblockPrompt } from "./ephemeral-modes";
import type { TriageItem } from "../../../shared/triage";

const item = (id: string, kind: TriageItem["kind"], updatedAt: number): TriageItem => ({ id, title: `T ${id}`, reason: "r", next: "n", kind, priority: 1, updatedAt, sourceUpdatedAt: updatedAt, source: `Work board · ${id}` });

describe("ephemeral modes", () => {
  test("pill cycles Normal → Annotate → Learn → Quick → Normal", () => {
    expect(nextPillMode("normal")).toBe("annotate");
    expect(nextPillMode("annotate")).toBe("learn");
    expect(nextPillMode("learn")).toBe("quick");
    expect(nextPillMode("quick")).toBe("normal");
    expect(pillModeOf(true, "quick")).toBe("annotate");
    expect(pillModeOf(false, null)).toBe("normal");
  });
  test("quick lists needs-you before blocked, hides running and hidden items", () => {
    const snap = { generatedAt: 1, warnings: [], items: [item("a", "blocked", 5), item("b", "running", 9), item("c", "owner", 1), item("d", "blocked", 7)] };
    expect(quickItems(snap, new Set()).map(i => i.id)).toEqual(["c", "d", "a"]);
    expect(quickItems(snap, new Set(["d"])).map(i => i.id)).toEqual(["c", "a"]);
  });
  test("prompts carry the mode tag, topic and blocker source", () => {
    expect(learnPrompt("quiz", "  TCP slow start ")).toContain("[Dash · Learn mode · quiz] Topic: TCP slow start");
    expect(learnPrompt("explain", "x")).toContain("```genui");
    expect(unblockPrompt(item("t_1", "owner", 1))).toContain("Source: Work board · t_1 (owner)");
  });
});
