#!/usr/bin/env bun
// dash-roadmap: read and update the Dash roadmap file (see bridge/src/roadmap-store.ts).
//
//   dash-roadmap ls [--json]
//   dash-roadmap set ID [--progress N] [--stage S] [--priority P0..P3] [--title T] [--area A]
//                       [--evidence E] [--next N] [--detail D] [--pr URL|N] [--you | --running | --clear]
//   dash-roadmap rm ID
//   dash-roadmap import-board BOARD.json
//
// `set` creates the item when --title is given. --you marks it as waiting on the owner (shown
// first, with --next as the action), --running as in progress now, --clear drops either mark.
import { readFileSync } from "node:fs";
import { importBoard, patchRoadmap, removeRoadmapItem, roadmapSections, ROADMAP_PRIORITIES, ROADMAP_STAGES, type RoadmapPatch } from "../shared/roadmap";
import { readRoadmap, roadmapFile, updateRoadmap } from "../bridge/src/roadmap-store";

const VALUE_FLAGS = ["progress", "stage", "priority", "title", "area", "evidence", "next", "detail", "pr"] as const;

export function parseSetArgs(args: string[]): RoadmapPatch {
  const patch: RoadmapPatch = {};
  for (let i = 0; i < args.length; i++) {
    const raw = args[i]!.replace(/^--/, "");
    if (raw === "you" || raw === "running") { patch.attention = raw; continue; }
    if (raw === "clear") { patch.attention = null; continue; }
    const flag = VALUE_FLAGS.find(f => f === raw);
    if (!flag) throw new Error(`unknown flag --${raw}`);
    const value = args[++i];
    if (value === undefined) throw new Error(`--${flag} needs a value`);
    switch (flag) {
      case "progress": { const n = Number(value.replace(/%$/, "")); if (!Number.isFinite(n)) throw new Error("--progress takes 0-100"); patch.progress = n; break; }
      case "stage": { const s = ROADMAP_STAGES.find(x => x === value); if (!s) throw new Error(`--stage is one of ${ROADMAP_STAGES.join(", ")}`); patch.stage = s; break; }
      case "priority": { const p = ROADMAP_PRIORITIES.find(x => x === value.toUpperCase()); if (!p) throw new Error("--priority is P0..P3"); patch.priority = p; break; }
      default: patch[flag] = value;
    }
  }
  return patch;
}

function main(argv: string[]): number {
  const [cmd, ...rest] = argv;
  const path = roadmapFile();
  const now = Date.now();
  if (cmd === "ls" || !cmd) {
    const doc = readRoadmap(path);
    if (rest.includes("--json")) { console.log(JSON.stringify(doc, null, 1)); return 0; }
    const s = roadmapSections(doc);
    const line = (i: (typeof doc.items)[number]) => `${i.id.padEnd(7)} ${(i.priority ?? "  ")} ${String(i.progress ?? "").padStart(3)}${i.progress === undefined ? " " : "%"} ${i.title}`;
    console.log(`${path}\n\nWaiting on you\n${s.you.map(line).join("\n") || "  none"}\n\nRunning now\n${s.running.map(line).join("\n") || "  none"}\n\nRoadmap\n${s.list.map(line).join("\n")}`);
    return 0;
  }
  if (cmd === "set") {
    const [id, ...flags] = rest;
    if (!id) throw new Error("usage: dash-roadmap set ID [flags]");
    const doc = updateRoadmap(d => patchRoadmap(d, id, parseSetArgs(flags), now), path);
    const item = doc.items.find(i => i.id === id);
    console.log(`ok ${id}: ${item?.progress ?? "-"}% ${item?.stage} ${item?.attention ?? ""}`.trim());
    return 0;
  }
  if (cmd === "rm") {
    const [id] = rest;
    if (!id) throw new Error("usage: dash-roadmap rm ID");
    updateRoadmap(d => removeRoadmapItem(d, id, now), path);
    console.log(`removed ${id}`);
    return 0;
  }
  if (cmd === "import-board") {
    const [file] = rest;
    if (!file) throw new Error("usage: dash-roadmap import-board BOARD.json");
    const doc = updateRoadmap(d => importBoard(d, JSON.parse(readFileSync(file, "utf8")), now), path);
    console.log(`imported: ${doc.items.length} items in ${path}`);
    return 0;
  }
  throw new Error(`unknown command "${cmd}" (ls, set, rm, import-board)`);
}

if (import.meta.main) {
  try { process.exit(main(process.argv.slice(2))); } catch (e) {
    console.error(`dash-roadmap: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
}
