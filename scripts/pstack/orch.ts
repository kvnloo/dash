#!/usr/bin/env bun
/**
 * Plain-file orchestrate bookkeeping for Dash nano-services.
 * Compatible enough with pstack's orch shape: units.tsv, preferences.md, status.md.
 *
 *   bun scripts/pstack/orch.ts --store orchestrate/dash init
 *   bun scripts/pstack/orch.ts --store orchestrate/dash status
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const UNIT_HEADER = "id\ttrack\tstate\tbranch\tpr\tsha\tbrief\n";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function storeDir(): string {
  const dir = arg("--store") ?? process.env.ORCH_STORE;
  if (!dir) throw new Error("set --store <dir> or ORCH_STORE");
  return dir;
}

function readUnits(dir: string): string[][] {
  const raw = readFileSync(join(dir, "units.tsv"), "utf8");
  const lines = raw.split("\n").filter((l) => l.length > 0);
  if (lines[0] !== UNIT_HEADER.trimEnd()) throw new Error("units.tsv has an invalid header");
  return lines.slice(1).map((l) => l.split("\t"));
}

function writeUnits(dir: string, rows: string[][]): void {
  writeFileSync(join(dir, "units.tsv"), UNIT_HEADER + rows.map((r) => r.join("\t")).join("\n") + (rows.length ? "\n" : ""));
}

function init(dir: string): void {
  mkdirSync(join(dir, "inbox"), { recursive: true });
  mkdirSync(join(dir, "briefs"), { recursive: true });
  if (!exists(join(dir, "units.tsv"))) writeFileSync(join(dir, "units.tsv"), UNIT_HEADER);
  if (!exists(join(dir, "preferences.md"))) writeFileSync(join(dir, "preferences.md"), "# Standing orders\n");
  if (!exists(join(dir, "gates.md"))) writeFileSync(join(dir, "gates.md"), "");
  if (!exists(join(dir, "frontier.json"))) writeFileSync(join(dir, "frontier.json"), `${JSON.stringify({ generation: 0, prs: [], lowestUnmerged: null }, null, 2)}\n`);
  console.log(`initialized ${dir}`);
}

function exists(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

function status(dir: string): void {
  const rows = readUnits(dir);
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row[2] ?? "?", (counts.get(row[2] ?? "") ?? 0) + 1);
  const stateLine = [...counts.entries()].map(([k, n]) => `${k}=${n}`).join(", ") || "none";
  const lines = [
    `# Dash orchestrate status`,
    "",
    `counts: units=${rows.length}; states=${stateLine}`,
    "",
    "| id | track | state | branch | brief |",
    "|----|-------|-------|--------|-------|",
    ...rows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} | ${r[6]} |`),
    "",
  ];
  writeFileSync(join(dir, "status.md"), lines.join("\n"));
  console.log(`counts: units=${rows.length}; states=${stateLine}`);
  console.log("changed: status.md rendered");
  console.log("gates open: 0");
}

function standingAdd(dir: string, line: string): void {
  const path = join(dir, "preferences.md");
  const prev = exists(path) ? readFileSync(path, "utf8") : "# Standing orders\n";
  const numbered = prev.trimEnd().split("\n").filter((l) => /^\d+\. /.test(l));
  const next = numbered.length + 1;
  writeFileSync(path, `${prev.trimEnd()}\n${next}. ${line}\n`);
  console.log(`${next}. ${line}`);
}

const argv = process.argv.slice(2).filter((a) => a !== "--store" && process.argv[process.argv.indexOf(a) - 1] !== "--store");
const cmd = argv[0];
const dir = storeDir();

switch (cmd) {
  case "init":
    init(dir);
    break;
  case "status":
    status(dir);
    break;
  case "standing":
    if (argv[1] === "add" && argv[2]) standingAdd(dir, argv.slice(2).join(" "));
    else if (argv[1] === "show") console.log(readFileSync(join(dir, "preferences.md"), "utf8"));
    else throw new Error("standing add <line> | standing show");
    break;
  default:
    throw new Error("usage: orch.ts --store <dir> init|status|standing ...");
}
