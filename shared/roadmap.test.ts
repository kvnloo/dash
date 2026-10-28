import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import snapshot from "../app/src/catalog/roadmap.json";
import { changedItems, emptyRoadmap, importBoard, parseRoadmap, patchRoadmap, prUrl, removeRoadmapItem, roadmapProgress, roadmapSections, stageFor } from "./roadmap";
import { readRoadmap, writeRoadmap, updateRoadmap } from "../bridge/src/roadmap-store";
import { parseSetArgs } from "../scripts/dash-roadmap";
import { roadmapNeeds } from "../bridge/src/orchestra-http";
import { createRoadmapHttpHandler } from "../bridge/src/roadmap-http";

const board = {
  now: ["Army run on RC3"],
  you: ["Merge .files PR #120", "Run sudo batch"],
  rows: [[1, "Dash works on S25", "P0", 45, "Fixed in PR #457"], [2, "Army only", "P0", 80, "#456 gate"], [3, "Blueprint", "P3", 20, "Design only"], [4, "Config reset", "P0", 100, "Done"]],
};

test("the bundled Ripple snapshot is a valid roadmap document (the model only adds optional fields)", () => {
  expect(parseRoadmap(snapshot)?.items.length).toBe(snapshot.items.length);
});

test("board import keeps one store: rows, waiting-on-you and running items", () => {
  const doc = importBoard(emptyRoadmap(), board, 1000);
  const s = roadmapSections(doc);
  expect(s.you.map(i => i.title)).toEqual(["Merge .files PR #120", "Run sudo batch"]);
  expect(s.you[0]?.next).toBe("Merge .files PR #120");
  expect(s.running.map(i => i.id)).toEqual(["now-1"]);
  // Priority order, finished last, lower progress first within a priority.
  expect(s.list.map(i => i.id)).toEqual(["1", "2", "3", "4"]);
  expect(doc.items.find(i => i.id === "1")).toMatchObject({ priority: "P0", progress: 45, stage: "partial" });
  expect(roadmapProgress(doc)).toBe(61);
  expect(parseRoadmap(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
});

test("patch moves stage with progress, marks attention, and reports what changed", () => {
  const a = importBoard(emptyRoadmap(), board, 1000);
  const b = patchRoadmap(a, "1", { progress: 85, evidence: "Deployed", attention: "running" }, 2000);
  expect(b.items.find(i => i.id === "1")).toMatchObject({ progress: 85, stage: "preview", attention: "running", updatedAt: 2000 });
  expect(changedItems(a, b)).toEqual(["1"]);
  const c = patchRoadmap(b, "1", { attention: null }, 3000);
  expect(c.items.find(i => i.id === "1")?.attention).toBeUndefined();
  expect(() => patchRoadmap(a, "missing", { progress: 1 }, 1)).toThrow(/--title/);
  expect(patchRoadmap(a, "new", { title: "New ask", priority: "P1" }, 1).items.at(-1)).toMatchObject({ id: "new", stage: "planned" });
  expect(removeRoadmapItem(a, "3", 1).items.some(i => i.id === "3")).toBe(false);
  expect(stageFor(0)).toBe("planned");
  expect(stageFor(100)).toBe("verified");
});

test("parse rejects duplicate ids and bad stages", () => {
  const item = { id: "x", title: "X", stage: "partial", area: "", detail: "", evidence: "", next: "" };
  expect(parseRoadmap({ id: "d", title: "D", items: [item, item] })).toBeNull();
  expect(parseRoadmap({ id: "d", title: "D", items: [{ ...item, stage: "wip" }] })).toBeNull();
  expect(parseRoadmap({ id: "d", title: "D", items: [{ ...item, progress: 140 }] })?.items[0]?.progress).toBe(100);
});

test("PR link: explicit field, else the first dash PR number in evidence", () => {
  const base = { id: "x", title: "X", stage: "partial" as const, area: "", detail: "", evidence: "Fixed in PR #457, army 4/4", next: "" };
  expect(prUrl(base)).toBe("https://github.com/kvnloo/dash/pull/457");
  expect(prUrl({ ...base, pr: "https://github.com/kvnloo/.files/pull/120" })).toBe("https://github.com/kvnloo/.files/pull/120");
  expect(prUrl({ ...base, evidence: "no link" })).toBeUndefined();
  expect(prUrl({ ...base, evidence: "Left: .files #120, sudo batch" })).toBeUndefined();
  expect(prUrl({ ...base, evidence: "#456 O15 gate; #465 verify-dash" })).toBe("https://github.com/kvnloo/dash/pull/456");
  expect(prUrl({ ...base, pr: "javascript:alert(1)" })).toBeUndefined();
});

test("store writes atomically and round-trips; CLI flags parse", () => {
  const path = join(mkdtempSync(join(tmpdir(), "roadmap-")), "nested", "roadmap.json");
  expect(readRoadmap(path).items).toEqual([]);
  updateRoadmap(d => importBoard(d, board, 1), path);
  expect(readRoadmap(path).items.length).toBe(7);
  expect(() => writeRoadmap({ ...emptyRoadmap(), items: [{ id: "", title: "", stage: "planned", area: "", detail: "", evidence: "", next: "" }] }, path)).toThrow();
  expect(JSON.parse(readFileSync(path, "utf8")).items.length).toBe(7);
  expect(parseSetArgs(["--progress", "60%", "--priority", "p1", "--you", "--next", "Approve"])).toEqual({ progress: 60, priority: "P1", attention: "you", next: "Approve" });
  expect(() => parseSetArgs(["--stage", "wip"])).toThrow();
});

test("GET /roadmap authenticates, then serves the document with its sections", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "roadmap-")), "roadmap.json");
  writeRoadmap(importBoard(emptyRoadmap(), board, 1), path);
  const handler = (ok: boolean) => createRoadmapHttpHandler({ authorize: async () => ok, path });
  expect(await handler(true)(new Request("http://h/other"))).toBeNull();
  expect((await handler(false)(new Request("http://h/roadmap")))?.status).toBe(401);
  expect((await handler(true)(new Request("http://h/roadmap", { method: "POST" })))?.status).toBe(405);
  const body = await (await handler(true)(new Request("http://h/roadmap")))?.json() as { sections: { you: string[] }; items: unknown[] };
  expect(body.sections.you).toEqual(["you-1", "you-2"]);
  expect(body.items.length).toBe(7);
});

test("waiting-on-you items reach the orchestrate triage lane as needs-you", () => {
  const needs = roadmapNeeds(importBoard(emptyRoadmap(), board, 1));
  expect(needs.map(n => n.id)).toEqual(["roadmap:you-1", "roadmap:you-2"]);
  expect(needs[0]).toMatchObject({ worker: "roadmap", recommended_action: "Merge .files PR #120" });
});
