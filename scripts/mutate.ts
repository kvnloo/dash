#!/usr/bin/env bun
/**
 * Mutation testing for the Dash contracts that must not drift by accident.
 *
 *   bun scripts/mutate.ts
 *   bun scripts/mutate.ts --dry-run
 *   bun scripts/mutate.ts --threshold 80 --max 200
 *
 * Mutates source in place, runs the paired tests, restores the file.
 * A surviving mutant means the suite would not have caught that edit —
 * the nav-dots / chrome-height class of "unintentional UI mutation".
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

export type Target = { file: string; tests: readonly string[] };

export const TARGETS: readonly Target[] = [
  { file: "app/src/components/golden-nav.ts", tests: ["app/src/components/golden-nav.test.ts"] },
  { file: "app/src/components/bridge-pull.ts", tests: ["app/src/components/bridge-pull.test.ts"] },
  { file: "app/src/motion.ts", tests: ["app/src/components/motion.test.ts"] },
  { file: "shared/protocol.ts", tests: ["shared/protocol.test.ts"] },
  { file: "bridge/src/roster.ts", tests: ["bridge/src/roster.test.ts"] },
];

export type Mutant = {
  file: string;
  index: number;
  start: number;
  end: number;
  original: string;
  replacement: string;
  operator: string;
};

export type MutantStatus = "killed" | "survived" | "timeout" | "invalid";

export type MutantResult = Mutant & { status: MutantStatus; ms: number };

export type MutationReport = {
  killed: number;
  survived: number;
  timeout: number;
  invalid: number;
  score: number;
  results: MutantResult[];
};

const NUMBER = /^(?:\d+\.\d+|\d+)/;

export function collectMutants(source: string, file: string): Mutant[] {
  const found: Omit<Mutant, "file" | "index">[] = [];
  let i = 0;
  const n = source.length;

  const push = (start: number, end: number, replacement: string, operator: string) => {
    const original = source.slice(start, end);
    if (original === replacement) return;
    found.push({ start, end, original, replacement, operator });
  };

  while (i < n) {
    const c = source[i]!;
    const next = source[i + 1];

    if (c === "/" && next === "/") {
      i = source.indexOf("\n", i);
      if (i < 0) break;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipQuoted(source, i, c);
      continue;
    }
    if (c === "`") {
      i = skipTemplate(source, i);
      continue;
    }

    if (c === "=" && next === ">" ) {
      i += 2;
      continue;
    }
    if (c === "=" && next === "=") {
      const len = source[i + 2] === "=" ? 3 : 2;
      if (isBinary(source, i)) push(i, i + len, len === 3 ? "!==" : "!=", "eq");
      i += len;
      continue;
    }
    if (c === "!" && next === "=") {
      const len = source[i + 2] === "=" ? 3 : 2;
      if (isBinary(source, i)) push(i, i + len, len === 3 ? "===" : "==", "eq");
      i += len;
      continue;
    }
    if (c === "&" && next === "&") {
      if (isBinary(source, i)) push(i, i + 2, "||", "logic");
      i += 2;
      continue;
    }
    if (c === "|" && next === "|") {
      if (isBinary(source, i)) push(i, i + 2, "&&", "logic");
      i += 2;
      continue;
    }

    if (identAt(source, i, "true")) {
      if (inExportConst(source, i)) push(i, i + 4, "false", "bool");
      i += 4;
      continue;
    }
    if (identAt(source, i, "false")) {
      if (inExportConst(source, i)) push(i, i + 5, "true", "bool");
      i += 5;
      continue;
    }

    if ((c >= "0" && c <= "9") && !isIdentChar(source[i - 1])) {
      const m = NUMBER.exec(source.slice(i));
      if (m) {
        const raw = m[0];
        const value = Number(raw);
        if (Number.isFinite(value) && inExportConst(source, i)) {
          if (value === 0) push(i, i + raw.length, "1", "num");
          else if (value === 1) push(i, i + raw.length, "0", "num");
          else push(i, i + raw.length, formatNum(value + 1, raw), "num");
        }
        i += raw.length;
        continue;
      }
    }

    i += 1;
  }

  return found.map((m, index) => ({ ...m, file, index }));
}

function skipQuoted(source: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i + 1;
    i += 1;
  }
  return source.length;
}

function skipTemplate(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === "`") return i + 1;
    if (source[i] === "$" && source[i + 1] === "{") {
      i += 2;
      let depth = 1;
      while (i < source.length && depth > 0) {
        if (source[i] === "`") {
          i = skipTemplate(source, i);
          continue;
        }
        if (source[i] === '"' || source[i] === "'") {
          i = skipQuoted(source, i, source[i]!);
          continue;
        }
        if (source[i] === "{") depth += 1;
        else if (source[i] === "}") depth -= 1;
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return source.length;
}


function inExportConst(source: string, i: number): boolean {
  let depth = 0;
  let j = i;
  while (j >= 0) {
    const ch = source[j]!;
    if (ch === "}") depth += 1;
    else if (ch === "{") depth -= 1;
    else if (ch === ";" && depth <= 0) break;
    j -= 1;
  }
  const slice = source.slice(j + 1, i);
  return /\bexport\s+const\b/.test(slice);
}

function isIdentChar(c: string | undefined): boolean {
  if (!c) return false;
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === "$";
}

function identAt(source: string, i: number, word: string): boolean {
  if (source.slice(i, i + word.length) !== word) return false;
  if (isIdentChar(source[i - 1]) || isIdentChar(source[i + word.length])) return false;
  return true;
}

function isBinary(source: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && (source[j] === " " || source[j] === "\t" || source[j] === "\n")) j -= 1;
  if (j < 0) return false;
  const prev = source[j]!;
  if (prev === "=" || prev === "(" || prev === "," || prev === "?" || prev === ":" || prev === "[") return false;
  if (prev === "+" || prev === "-" || prev === "*" || prev === "/" || prev === "!") return false;
  return true;
}

function formatNum(value: number, original: string): string {
  return original.includes(".") ? String(value) : String(Math.trunc(value));
}

export function applyMutant(source: string, mutant: Pick<Mutant, "start" | "end" | "replacement">): string {
  return source.slice(0, mutant.start) + mutant.replacement + source.slice(mutant.end);
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

export async function runMutation(opts: {
  root?: string;
  targets?: readonly Target[];
  threshold?: number;
  max?: number;
  timeoutMs?: number;
  dryRun?: boolean;
}): Promise<MutationReport> {
  const root = opts.root ?? ROOT;
  const threshold = opts.threshold ?? 80;
  const max = opts.max ?? 200;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const targets = opts.targets ?? TARGETS;
  const dryRun = opts.dryRun ?? false;

  const mutants: Mutant[] = [];
  for (const target of targets) {
    const source = readFileSync(join(root, target.file), "utf8");
    const rank = (op: string) => (op === "num" ? 0 : op === "bool" ? 1 : op === "eq" ? 2 : 3);
    const found = collectMutants(source, target.file).sort((a, b) => rank(a.operator) - rank(b.operator));
    const cap = Math.max(8, Math.floor(max / targets.length));
    const core = found.filter((m) => m.operator === "num" || m.operator === "bool");
    const ops = found.filter((m) => m.operator === "eq" || m.operator === "logic").slice(0, 2);
    for (const m of [...core, ...ops].slice(0, cap)) mutants.push(m);
  }
  const selected = mutants.slice(0, max);

  if (dryRun) {
    return {
      killed: 0,
      survived: 0,
      timeout: 0,
      invalid: 0,
      score: 100,
      results: selected.map((m) => ({ ...m, status: "killed", ms: 0 })),
    };
  }

  const results: MutantResult[] = [];
  for (const mutant of selected) {
    const target = targets.find((t) => t.file === mutant.file);
    if (!target) continue;
    const abs = join(root, mutant.file);
    const original = readFileSync(abs, "utf8");
    writeFileSync(abs, applyMutant(original, mutant));
    const started = Date.now();
    let status: MutantStatus = "survived";
    try {
      const proc = Bun.spawn(["bun", "test", ...target.tests], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      const killer = setTimeout(() => proc.kill(), timeoutMs);
      const code = await proc.exited;
      clearTimeout(killer);
      const ms = Date.now() - started;
      if (ms >= timeoutMs - 50 && code !== 0) status = "timeout";
      else if (code === 0) status = "survived";
      else status = "killed";
      results.push({ ...mutant, status, ms });
    } catch {
      results.push({ ...mutant, status: "invalid", ms: Date.now() - started });
    } finally {
      writeFileSync(abs, original);
    }
  }

  const killed = results.filter((r) => r.status === "killed").length;
  const survived = results.filter((r) => r.status === "survived").length;
  const timeout = results.filter((r) => r.status === "timeout").length;
  const invalid = results.filter((r) => r.status === "invalid").length;
  const scored = killed + survived;
  const score = scored === 0 ? 100 : Math.round((100 * killed) / scored);
  void threshold;
  return { killed, survived, timeout, invalid, score, results };
}

function printReport(report: MutationReport, threshold: number, dryRun: boolean): void {
  if (dryRun) {
    console.log(`dry-run: ${report.results.length} mutants`);
    for (const m of report.results) {
      console.log(`  ${m.file}:${m.index} ${m.operator} ${JSON.stringify(m.original)} → ${JSON.stringify(m.replacement)}`);
    }
    return;
  }
  const survivors = report.results.filter((r) => r.status === "survived");
  console.log(
    JSON.stringify(
      {
        score: report.score,
        killed: report.killed,
        survived: report.survived,
        timeout: report.timeout,
        invalid: report.invalid,
        total: report.results.length,
        threshold,
        survivors: survivors.map((s) => ({
          file: s.file,
          operator: s.operator,
          from: s.original,
          to: s.replacement,
        })),
      },
      null,
      2,
    ),
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const threshold = Number(arg("--threshold", "80"));
  const max = Number(arg("--max", "200"));
  const dryRun = hasFlag("--dry-run");
  const file = arg("--file");
  const targets = file ? TARGETS.filter((t) => t.file === file) : TARGETS;
  if (file && targets.length === 0) {
    console.error(`unknown --file ${file}`);
    process.exit(1);
  }
  const report = await runMutation({ threshold, max, dryRun, targets });
  printReport(report, threshold, dryRun);
  process.exit(!dryRun && report.score < threshold ? 1 : 0);
}

