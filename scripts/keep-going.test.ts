import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DASH_DONE_SLICES, SUBAGENT_EFFORT, SUBAGENT_MODELS, nextOpenSlice, shouldKeepGoing } from "../orchestrate/dash/done";

const root = join(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("keep going until Dash is done", () => {
  test("an empty claimable label is not a stop; open slices keep the loop alive", () => {
    const skill = read(".cursor/skills/autodevelop/SKILL.md");
    expect(skill.includes("If nothing is claimable: stop")).toBe(false);
    expect(skill).toContain("orchestrate/dash/done");
    expect(skill).toContain("shouldKeepGoing");
    expect(skill).toContain("TDD");
  });

  test("spawned subagents are low-effort models", () => {
    expect(SUBAGENT_EFFORT).toBe("low");
    expect(SUBAGENT_MODELS).toContain("cursor-grok-4.6-low");
    expect(SUBAGENT_MODELS).toContain("cursor-grok-4.6-low-fast");
    const prefs = read("orchestrate/dash/preferences.md");
    expect(prefs).toContain("cursor-grok-4.6-low");
    expect(prefs.toLowerCase()).toContain("low");
  });

  test("CI runs this heartbeat", () => {
    expect(read(".github/workflows/ci.yml")).toContain("scripts/keep-going.test.ts");
  });

  test("blocked claimed work is not a reason to idle while an open slice remains", () => {
    const blocked = DASH_DONE_SLICES.filter((s) => s.state === "blocked");
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.every((s) => typeof s.blockedBy === "string" && s.blockedBy.length > 0)).toBe(true);
    expect(shouldKeepGoing()).toBe(Boolean(nextOpenSlice()));
  });
});
