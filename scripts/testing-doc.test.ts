import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TARGETS } from "./mutate.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rootScriptNames(): ReadonlySet<string> {
  const parsed: unknown = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  if (!isRecord(parsed) || !isRecord(parsed.scripts)) {
    throw new Error("package.json must contain a scripts record");
  }
  const entries = Object.entries(parsed.scripts);
  if (entries.some(([, command]) => typeof command !== "string")) {
    throw new Error("package.json scripts must be strings");
  }
  return new Set(entries.map(([name]) => name));
}

/**
 * Validate repo-local paths quoted in Markdown code spans (including command
 * arguments), and every root `bun run` script name. Pure: path lookup and the
 * script registry are injected so malformed documentation can be tested.
 */
export function checkTestingDoc(
  text: string,
  exists: (path: string) => boolean,
  scripts: ReadonlySet<string>,
): void {
  const paths = new Set<string>();
  const scriptNames = new Set<string>();

  for (const codeSpan of text.matchAll(/`([^`\r\n]+)`/g)) {
    const code = codeSpan[1];
    if (code === undefined) continue;
    for (const match of code.matchAll(
      /(?<![A-Za-z0-9_./-])((?:scripts|\.maestro|docs|\.cursor|app|bridge|shared)\/[A-Za-z0-9_./-]+)/g,
    )) {
      const path = match[1]?.replace(/[.,;:]+$/, "");
      if (path) paths.add(path);
    }
  }

  // Linked relative files are documentation dependencies too, even if unquoted.
  for (const link of text.matchAll(/\]\((?:\.\/)?((?:scripts|\.maestro|docs|\.cursor|app|bridge|shared)\/[A-Za-z0-9_./-]+)(?:#[^)]*)?\)/g)) {
    const path = link[1];
    if (path) paths.add(path);
  }

  for (const command of text.matchAll(/\bbun\s+run\s+([A-Za-z0-9:._-]+)/g)) {
    const name = command[1];
    if (name) scriptNames.add(name);
  }

  const missingPaths = [...paths].filter((path) => !exists(path)).sort();
  const missingScripts = [...scriptNames].filter((name) => !scripts.has(name)).sort();
  const errors: string[] = [];
  if (missingPaths.length) errors.push("Missing repository paths: " + missingPaths.join(", "));
  if (missingScripts.length) errors.push("Missing package.json scripts: " + missingScripts.join(", "));
  if (errors.length) throw new Error(errors.join("\n"));
}


/**
 * Keep the gate inventory honest: every expected layer must contain a concrete
 * invocation, a meaningful catch/limit, and an affirmative execution venue.
 * In particular, "not CI" alone is not evidence that a gate runs anywhere.
 */
export function checkLayerRows(text: string): void {
  const section = text.split("## Verification layers\n")[1]?.split("\n## ")[0];
  if (!section) throw new Error("Missing verification layers section");
  const lines = section.split("\n").filter((line) => line.startsWith("| "));
  const [heading, divider, ...rows] = lines;
  if (heading !== "| Layer | Command | Catches | Cannot catch | Runs |" ||
      divider !== "| --- | --- | --- | --- | --- |") {
    throw new Error("Verification layer table headers changed");
  }
  const expected: ReadonlyArray<{ name: string; venue: RegExp }> = [
    { name: "Unit", venue: /^Local\b/ },
    { name: "TDD", venue: /^Local\b/ },
    { name: "Mutation", venue: /^Local\b/ },
    { name: "Typecheck/Lint", venue: /^Local\b/ },
    { name: "Runtime (verify-dash)", venue: /^Controlled local\b/ },
    { name: "Device (Maestro + assert-nav-dots)", venue: /^Phone\b/ },
    { name: "Proof scripts", venue: /^Isolated local\b/ },
    { name: "CI gates", venue: /^CI\b/ },
  ];
  if (rows.length !== expected.length) throw new Error("Expected eight verification layers");
  for (const [index, layer] of expected.entries()) {
    const cells = rows[index]?.split("|").slice(1, -1).map((cell) => cell.trim());
    if (!cells || cells.length !== 5 || cells[0] !== layer.name) {
      throw new Error("Missing or misordered layer: " + layer.name);
    }
    const [, command, catches, cannot, venue] = cells;
    if (!command || !/\x60(?:bun|bash|node|python3)\s+[^\x60]+\x60/.test(command)) {
      throw new Error(layer.name + ": missing concrete command");
    }
    if (!catches || catches.length < 11) throw new Error(layer.name + ": missing catches");
    if (!cannot || cannot.length < 11) throw new Error(layer.name + ": missing limits");
    if (!venue || !layer.venue.test(venue)) {
      throw new Error(layer.name + ": missing affirmative execution venue");
    }
  }
}

/** Exact documented targets, kept in sync with the actual mutator registry. */
export function mutationFilesFromDoc(text: string): string[] {
  const section = text.split("### Mutation: current target files\n")[1]?.split("\n## ")[0];
  if (!section) throw new Error("Missing mutation inventory");
  return [...section.matchAll(/\x60((?:app|bridge|shared)\/[A-Za-z0-9_./-]+)\x60/g)]
    .map((match) => match[1])
    .filter((path): path is string => path !== undefined)
    .sort();
}

const DOC = readFileSync(join(ROOT, "TESTING.md"), "utf8");

test("rejects a nonexistent backticked repository path", () => {
  expect(() =>
    checkTestingDoc("Read `scripts/not-a-real-file.ts`.", () => false, new Set()),
  ).toThrow("Missing repository paths: scripts/not-a-real-file.ts");
});

test("checks backticked command arguments, not only standalone paths", () => {
  expect(() =>
    checkTestingDoc("Run `bun scripts/ghost.ts --dry-run`.", () => false, new Set()),
  ).toThrow("Missing repository paths: scripts/ghost.ts");
});

test("rejects bun run commands absent from root package.json", () => {
  expect(() =>
    checkTestingDoc("Run `bun run phantom:check`.", () => true, new Set(["test"])),
  ).toThrow("Missing package.json scripts: phantom:check");
});

test("reports both path and script mistakes in one pass", () => {
  expect(() =>
    checkTestingDoc(
      "`bun run fake` then `.maestro/missing.yaml`",
      () => false,
      new Set(["test"]),
    ),
  ).toThrow("Missing repository paths: .maestro/missing.yaml\nMissing package.json scripts: fake");
});

test("checks quoted paths only, but detects bare bun run script names", () => {
  expect(() =>
    checkTestingDoc("Unquoted scripts/example-that-does-not-exist.ts", () => false, new Set()),
  ).not.toThrow();
  expect(() =>
    checkTestingDoc("bun run missing:even-without-backticks", () => true, new Set()),
  ).toThrow("Missing package.json scripts: missing:even-without-backticks");
});

test("the actual guide names only existing files, directories and registered scripts", () => {
  expect(() =>
    checkTestingDoc(DOC, (path) => existsSync(join(ROOT, path)), rootScriptNames()),
  ).not.toThrow();
});

test("every verification layer documents command, catches, limits and execution venue", () => {
  const section = DOC.split("## Verification layers\n")[1]?.split("\n## ")[0];
  expect(section).toBeDefined();
  const lines = (section ?? "").split("\n").filter((line) => line.startsWith("| "));
  const rows = lines.slice(2).map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
  const expected = [
    "Unit",
    "TDD",
    "Mutation",
    "Typecheck/Lint",
    "Runtime (verify-dash)",
    "Device (Maestro + assert-nav-dots)",
    "Proof scripts",
    "CI gates",
  ];
  expect(rows.map((row) => row[0])).toEqual(expected);
  for (const row of rows) {
    expect(row).toHaveLength(5);
    expect(row.every((cell) => cell.length > 0)).toBe(true);
    expect(row[1]).toContain("`");
    expect(row[2]?.length).toBeGreaterThan(10);
    expect(row[3]?.length).toBeGreaterThan(10);
    expect(row[4]).toMatch(/Local|CI|Phone/);
  }
});



test("rejects a missing path in a relative Markdown link", () => {
  expect(() =>
    checkTestingDoc("See [instructions](docs/removed-guide.md).", () => false, new Set()),
  ).toThrow("Missing repository paths: docs/removed-guide.md");
});

test("rejects an invalid script next to a valid script", () => {
  expect(() =>
    checkTestingDoc("Run bun run test, then bun run missing:gate", () => true, new Set(["test"])),
  ).toThrow("Missing package.json scripts: missing:gate");
});

test("checks all eight gate rows with concrete commands and truthful venues", () => {
  expect(() => checkLayerRows(DOC)).not.toThrow();
});

test("rejects a gate whose command was removed", () => {
  const broken = DOC.replace(
    /\| Unit \| [^\n|]+ \|/,
    "| Unit | No runnable invocation |",
  );
  expect(broken).not.toBe(DOC);
  expect(() => checkLayerRows(broken)).toThrow("Unit: missing concrete command");
});

test("rejects a gate that merely says it does not run in CI", () => {
  const broken = DOC.replace("Local; root \x60test\x60 in CI", "not CI");
  expect(broken).not.toBe(DOC);
  expect(() => checkLayerRows(broken)).toThrow("Unit: missing affirmative execution venue");
});

test("mutation inventory exactly matches the executable TARGETS registry", () => {
  expect(mutationFilesFromDoc(DOC)).toEqual(TARGETS.map((target) => target.file).sort());
});

test("a drifted mutation target cannot satisfy the inventory check", () => {
  const broken = DOC.replace("app/src/lib/pending-queue.ts", "app/src/lib/ghost-queue.ts");
  expect(broken).not.toBe(DOC);
  expect(mutationFilesFromDoc(broken)).not.toEqual(TARGETS.map((target) => target.file).sort());
});
