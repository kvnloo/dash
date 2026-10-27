#!/usr/bin/env bun
/**
 * Source-level JSX touchable-label ratchet. This is a static coverage guard,
 * not a replacement for screen-reader and device verification.
 *
 * bun scripts/a11y-coverage.ts [--write-baseline] [--json]
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

export type Finding = {
  file: string;
  line: number;
  component: string;
  hasLabel: boolean;
  hasRole: boolean;
  spreadProps: boolean;
};

export type Baseline = { unlabeled: Record<string, number> };

export type RatchetIncrease = {
  file: string;
  line: number;
  previous: number;
  current: number;
};

export type RatchetDecrease = {
  file: string;
  previous: number;
  current: number;
};

export type CoverageReport = {
  ok: boolean;
  scanned: number;
  unlabeled: Record<string, number>;
  increases: RatchetIncrease[];
  decreases: RatchetDecrease[];
  spreadProps: Finding[];
};

const TOUCHABLES = new Set([
  "Pressable",
  "TouchableOpacity",
  "TouchableHighlight",
  "TouchableWithoutFeedback",
  "Switch",
  "Animated.Pressable",
]);

function skipLine(text: string, start: number): number {
  const end = text.indexOf("\n", start);
  return end < 0 ? text.length : end + 1;
}

function skipBlock(text: string, start: number): number {
  const end = text.indexOf("*/", start + 2);
  return end < 0 ? text.length : end + 2;
}

function skipQuoted(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    // A nested template interpolation may contain quoted text and braces.
    if (quote === "\x60" && text[i] === "$" && text[i + 1] === "{") {
      i = skipBraces(text, i + 1);
      continue;
    }
    if (text[i] === quote) return i + 1;
    i++;
  }
  return text.length;
}

function skipBraces(text: string, start: number): number {
  let depth = 1;
  let i = start + 1;
  while (i < text.length && depth > 0) {
    if (text.startsWith("//", i)) { i = skipLine(text, i); continue; }
    if (text.startsWith("/*", i)) { i = skipBlock(text, i); continue; }
    if (text[i] === "'" || text[i] === '"' || text[i] === "\x60") {
      i = skipQuoted(text, i);
      continue;
    }
    if (text[i] === "{") depth++;
    else if (text[i] === "}") depth--;
    i++;
  }
  return i;
}

/** Collect aliases of Animated.createAnimatedComponent(Pressable) in this file. */
function componentNames(text: string): Set<string> {
  const names = new Set(TOUCHABLES);
  const aliases = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*Animated\s*\.\s*createAnimatedComponent\s*\(\s*Pressable\s*\)/g;
  for (const match of text.matchAll(aliases)) {
    if (match[1]) names.add(match[1]);
  }
  return names;
}

type Opening = {
  end: number;
  hasLabel: boolean;
  hasRole: boolean;
  spreadProps: boolean;
};

function readOpening(text: string, from: number): Opening | null {
  let i = from;
  let hasLabel = false;
  let hasRole = false;
  let spreadProps = false;

  while (i < text.length) {
    const c = text[i];
    if (c === ">") return { end: i + 1, hasLabel, hasRole, spreadProps };
    if (c === "{") {
      let start = i + 1;
      while (/\s/.test(text[start] ?? "") && start < text.length) start++;
      if (text.slice(start, start + 3) === "...") spreadProps = true;
      i = skipBraces(text, i);
      continue;
    }
    if (c === "'" || c === '"' || c === "\x60") {
      i = skipQuoted(text, i);
      continue;
    }
    if (c && /[A-Za-z_:]/.test(c)) {
      const match = /^[A-Za-z_:][\w:-]*/.exec(text.slice(i));
      if (match) {
        const attr = match[0];
        if (attr === "accessibilityLabel" || attr === "aria-label") hasLabel = true;
        if (attr === "accessibilityRole" || attr === "role") hasRole = true;
        i += attr.length;
        continue;
      }
    }
    i++;
  }
  // A malformed/unclosed opening cannot produce a reliable finding.
  return null;
}

/** Inspect JSX openings without mistaking a nested expression's > for the tag end. */
export function scanSource(file: string, text: string): Finding[] {
  const names = componentNames(text);
  const found: Finding[] = [];
  let i = 0;
  let line = 1;

  while (i < text.length) {
    const start = i;
    if (text.startsWith("//", i)) i = skipLine(text, i);
    else if (text.startsWith("/*", i)) i = skipBlock(text, i);
    else if (text[i] === "'" || text[i] === '"' || text[i] === "\x60") i = skipQuoted(text, i);
    else if (text[i] === "<" && text[i + 1] !== "/") {
      const match = /^<([A-Za-z_$][\w$.]*)/.exec(text.slice(i));
      if (match && names.has(match[1] ?? "")) {
        const afterName = i + match[0].length;
        const boundary = text[afterName];
        if (boundary === ">" || boundary === "/" || (boundary !== undefined && /\s/.test(boundary))) {
          const opening = readOpening(text, afterName);
          if (opening) {
            found.push({
              file,
              line,
              component: match[1] ?? "",
              hasLabel: opening.hasLabel,
              hasRole: opening.hasRole,
              spreadProps: opening.spreadProps,
            });
            i = opening.end;
          } else i++;
        } else i++;
      } else i++;
    } else i++;
    for (let j = start; j < i; j++) if (text[j] === "\n") line++;
  }
  return found;
}

/** Scan only application TSX, excluding tests, mock and vendor directories. */
export function scanTree(root: string): Finding[] {
  const sourceRoot = join(root, "app", "src");
  const findings: Finding[] = [];
  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__" && entry.name !== "vendor" && entry.name !== "mock") walk(path);
      } else if (entry.isFile() && entry.name.endsWith(".tsx")
        && !entry.name.endsWith(".test.tsx") && !entry.name.endsWith(".spec.tsx")) {
        const file = relative(root, path).split(sep).join("/");
        findings.push(...scanSource(file, readFileSync(path, "utf8")));
      }
    }
  }
  walk(sourceRoot);
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export function buildBaseline(findings: readonly Finding[]): Baseline {
  const counts: Record<string, number> = {};
  for (const finding of findings) {
    if (!finding.hasLabel && !finding.spreadProps) {
      counts[finding.file] = (counts[finding.file] ?? 0) + 1;
    }
  }
  return { unlabeled: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) };
}

/** Reject malformed baselines instead of quietly permitting regressions. */
export function parseBaseline(raw: string): Baseline {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || !("unlabeled" in parsed)) {
    throw new Error("invalid a11y baseline: missing unlabeled map");
  }
  const input = parsed.unlabeled;
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("invalid a11y baseline: unlabeled must be a map");
  }
  const unlabeled: Record<string, number> = {};
  for (const [file, count] of Object.entries(input)) {
    if (!file.startsWith("app/src/") || !file.endsWith(".tsx")
      || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw new Error("invalid a11y baseline entry: " + file);
    }
    unlabeled[file] = count;
  }
  return { unlabeled };
}

export function checkRatchet(findings: readonly Finding[], baseline: Baseline): CoverageReport {
  const current = buildBaseline(findings).unlabeled;
  const increases: RatchetIncrease[] = [];
  const decreases: RatchetDecrease[] = [];
  const files = new Set([...Object.keys(baseline.unlabeled), ...Object.keys(current)]);
  for (const file of [...files].sort()) {
    const previous = baseline.unlabeled[file] ?? 0;
    const now = current[file] ?? 0;
    if (now > previous) {
      const unlabeled = findings.filter(f => f.file === file && !f.hasLabel && !f.spreadProps);
      increases.push({ file, line: unlabeled[previous]?.line ?? unlabeled[0]?.line ?? 1, previous, current: now });
    } else if (now < previous) decreases.push({ file, previous, current: now });
  }
  return {
    ok: increases.length === 0,
    scanned: findings.length,
    unlabeled: current,
    increases,
    decreases,
    spreadProps: findings.filter(f => f.spreadProps),
  };
}

export function formatReport(report: CoverageReport): string {
  const rows: string[] = [
    "a11y label coverage: " + (report.ok ? "PASS" : "FAIL")
      + " (" + report.scanned + " touchables, "
      + Object.values(report.unlabeled).reduce((sum, n) => sum + n, 0) + " unlabeled)",
  ];
  for (const change of report.increases) {
    rows.push(change.file + ":" + change.line + " unlabeled " + change.previous + " -> " + change.current + " (ratchet regression)");
  }
  for (const change of report.decreases) {
    rows.push("ratchet down: " + change.file + " " + change.previous + " -> " + change.current);
  }
  for (const finding of report.spreadProps) {
    rows.push("spread props (review separately): " + finding.file + ":" + finding.line + " " + finding.component);
  }
  return rows.join("\n");
}

export function runCoverage(root: string, writeBaseline = false): CoverageReport {
  const findings = scanTree(root);
  const baselinePath = join(root, "scripts", "a11y-coverage.baseline.json");
  const baseline = writeBaseline
    ? buildBaseline(findings)
    : parseBaseline(readFileSync(baselinePath, "utf8"));
  if (writeBaseline) {
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
  }
  return checkRatchet(findings, baseline);
}

function main(args: readonly string[]): number {
  const supported = new Set(["--write-baseline", "--json"]);
  const unknown = args.find(arg => !supported.has(arg));
  if (unknown) {
    console.error("Unknown option " + unknown + ". Usage: bun scripts/a11y-coverage.ts [--write-baseline] [--json]");
    return 2;
  }
  const writeBaseline = args.includes("--write-baseline");
  const report = runCoverage(ROOT, writeBaseline);
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    if (writeBaseline) console.log("Wrote scripts/a11y-coverage.baseline.json (review before committing).");
    console.log(formatReport(report));
  }
  return report.ok ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "Accessibility scan failed");
    process.exitCode = 1;
  }
}
