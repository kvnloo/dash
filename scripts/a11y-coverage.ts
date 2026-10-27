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
  selfClosing: boolean;
  hasLabel: boolean;
  hasRole: boolean;
  spreadProps: boolean;
};

/**
 * Walk JSX elements and their embedded JS separately: JSX text is not JS code.
 * In particular, an apostrophe in a Text child must not start a JS string,
 * and JSX nested in a prop expression must be visited, not skipped.
 */
export function scanSource(file: string, text: string): Finding[] {
  const names = componentNames(text);
  const found: { offset: number; finding: Finding }[] = [];
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") lineStarts.push(i + 1);
  }

  function lineAt(offset: number): number {
    let low = 0;
    let high = lineStarts.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if ((lineStarts[mid] ?? 0) <= offset) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  function skipString(start: number): number {
    const quote = text[start];
    let i = start + 1;
    while (i < text.length) {
      if (text[i] === "\\") { i += 2; continue; }
      if (text[i] === quote) return i + 1;
      i++;
    }
    return text.length;
  }

  function skipTemplate(start: number): number {
    let i = start + 1;
    while (i < text.length) {
      if (text[i] === "\\") { i += 2; continue; }
      if (text[i] === "\x60") return i + 1;
      if (text[i] === "$" && text[i + 1] === "{") {
        i = visitCode(i + 2, true);
        continue;
      }
      i++;
    }
    return text.length;
  }

  /** Regex bodies are opaque JS tokens, including escapes and character classes. */
  function skipRegex(start: number): number {
    let inClass = false;
    let i = start + 1;
    while (i < text.length) {
      const c = text[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "\n" || c === "\r") return i;
      if (c === "[") inClass = true;
      if (c === "]") inClass = false;
      if (c === "/" && !inClass) {
        i++;
        while (/[a-z]/i.test(text[i] ?? "")) i++;
        return i;
      }
      i++;
    }
    return i;
  }

  /** JS region, optionally terminated by its matching closing brace. */
  function visitCode(start: number, untilBrace = false): number {
    let i = start;
    let depth = untilBrace ? 1 : 0;
    // Track significant tokens, not raw source prefixes: comments are trivia.
    let expressionStart = true;
    let controlKeyword = false;
    const controlParens: boolean[] = [];
    while (i < text.length) {
      const c = text[i] ?? "";
      if (/\s/.test(c)) { i++; continue; }
      if (text.startsWith("//", i)) { i = skipLine(text, i); continue; }
      if (text.startsWith("/*", i)) { i = skipBlock(text, i); continue; }
      if (c === "'" || c === '"' || c === "\x60") {
        i = c === "\x60" ? skipTemplate(i) : skipString(i);
        expressionStart = false;
        continue;
      }
      if (c === "/" && expressionStart) {
        i = skipRegex(i);
        expressionStart = false;
        continue;
      }
      if (c === "<" && expressionStart) {
        const end = visitElement(i);
        if (end !== null) { i = end; expressionStart = true; continue; }
      }
      if (/[A-Za-z_$]/.test(c)) {
        const token = /^[\w$]+/.exec(text.slice(i))?.[0] ?? c;
        controlKeyword = /^(?:if|while|for|with|switch|catch)$/.test(token);
        expressionStart = controlKeyword || /^(?:return|yield|default|throw|case|delete|void|typeof|new|in|of|instanceof|await|else|do)$/.test(token);
        i += token.length;
        continue;
      }
      if (c === "(") {
        controlParens.push(controlKeyword);
        expressionStart = true;
      } else if (c === ")") {
        expressionStart = controlParens.pop() === true;
      } else if (c === "{") {
        depth++;
        expressionStart = true;
      } else if (c === "}") {
        if (untilBrace && --depth === 0) return i + 1;
        expressionStart = true;
      } else {
        expressionStart = "=([,?:!&|>;+-*%~^/".includes(c);
      }
      controlKeyword = false;
      i++;
    }
    return i;
  }

  function readOpening(from: number): Opening | null {
    let i = from;
    let hasLabel = false;
    let hasRole = false;
    let spreadProps = false;
    while (i < text.length) {
      const c = text[i];
      if (c === ">") {
        let previous = i - 1;
        while (previous >= from && /\s/.test(text[previous] ?? "")) previous--;
        return { end: i + 1, selfClosing: text[previous] === "/", hasLabel, hasRole, spreadProps };
      }
      if (text.startsWith("//", i)) { i = skipLine(text, i); continue; }
      if (text.startsWith("/*", i)) { i = skipBlock(text, i); continue; }
      if (c === "{") {
        let prop = i + 1;
        while (prop < text.length && /\s/.test(text[prop] ?? "")) prop++;
        if (text.slice(prop, prop + 3) === "...") spreadProps = true;
        i = visitCode(i + 1, true);
        continue;
      }
      if (c === "'" || c === '"') { i = skipString(i); continue; }
      if (c === "\x60") { i = skipTemplate(i); continue; }
      if (c && /[A-Za-z_:]/.test(c)) {
        const match = /^[A-Za-z_:][\w:-]*/.exec(text.slice(i));
        if (match) {
          if (match[0] === "accessibilityLabel" || match[0] === "aria-label") hasLabel = true;
          if (match[0] === "accessibilityRole" || match[0] === "role") hasRole = true;
          i += match[0].length;
          continue;
        }
      }
      i++;
    }
    return null;
  }

  /** Child text keeps quotes and punctuation literal; only tags and {JS} are special. */
  function visitChildren(start: number): number {
    let i = start;
    while (i < text.length) {
      if (text.startsWith("</", i)) {
        const close = text.indexOf(">", i + 2);
        return close < 0 ? text.length : close + 1;
      }
      if (text[i] === "<") {
        const end = visitElement(i);
        if (end !== null) { i = end; continue; }
      }
      if (text[i] === "{") { i = visitCode(i + 1, true); continue; }
      i++;
    }
    return i;
  }

  function visitElement(start: number): number | null {
    let name = "";
    let afterName = start + 1;
    if (!text.startsWith("<>", start)) {
      const match = /^<([A-Za-z_$][\w$.]*)/.exec(text.slice(start));
      if (!match) return null;
      name = match[1] ?? "";
      afterName = start + match[0].length;
      const boundary = text[afterName];
      if (boundary !== ">" && boundary !== "/" && (boundary === undefined || !/\s/.test(boundary))) {
        return null;
      }
      // The JS walker already validated expression position using significant
      // tokens; the children walker is in JSX text where no such check is needed.
      if (!names.has(name) && /^\s+extends\b/.test(text.slice(afterName))) return null;
      if (!names.has(name) && /^[A-Z]$/.test(name)) return null;
    }

    const opening = readOpening(afterName);
    if (!opening) return null;
    if (names.has(name)) {
      found.push({
        offset: start,
        finding: {
          file,
          line: lineAt(start),
          component: name,
          hasLabel: opening.hasLabel,
          hasRole: opening.hasRole,
          spreadProps: opening.spreadProps,
        },
      });
    }
    return opening.selfClosing ? opening.end : visitChildren(opening.end);
  }

  visitCode(0);
  return found.sort((a, b) => a.offset - b.offset).map(entry => entry.finding);
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
