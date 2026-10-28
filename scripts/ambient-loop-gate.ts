#!/usr/bin/env bun
/**
 * DF-088: reject newly introduced ungated ambient loops, and require the
 * allowance to shrink whenever an existing ungated loop is eliminated.
 *
 * This is a source-level ratchet, not proof of device lifecycle correctness.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));

export type LoopKind = "withRepeat" | "setInterval";
export type LoopSite = {
  file: string;
  line: number;
  kind: LoopKind;
  gated: boolean;
};

const SKIPPED_DIRS = new Set([
  "__mocks__", "__tests__", "fixtures", "mock", "mocks", "node_modules", "vendor",
]);
const GATE_IDENTIFIERS = new Set([
  "AppState", "useReducedMotion", "reduced", "isFocused", "useIsFocused",
  "cancelAnimation", "clearInterval",
]);

/** Accept application source only; exclude tests, vendor, mocks and fixtures. */
export function shouldScanPath(file: string): boolean {
  const parts = file.replace(/\\/g, "/").split("/");
  if (parts.length < 3 || parts[0] !== "app" || parts[1] !== "src") return false;
  if (parts.some(part => SKIPPED_DIRS.has(part))) return false;
  const name = parts[parts.length - 1] ?? "";
  return /\.(ts|tsx)$/.test(name)
    && !name.endsWith(".d.ts")
    && !/\.(test|spec|mock|fixture)(\.|$)/.test(name);
}

function hasActiveAnd(node: ts.Node): boolean {
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) return false;
  const left = node.left;
  return (ts.isIdentifier(left) && left.text === "active")
    || (ts.isPropertyAccessExpression(left) && left.name.text === "active");
}

function hasGate(body: ts.Node): boolean {
  let gated = false;
  const visit = (node: ts.Node): void => {
    if (gated) return;
    if ((ts.isIdentifier(node) && GATE_IDENTIFIERS.has(node.text)) || hasActiveAnd(node)) {
      gated = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return gated;
}

/** Limit the check to the closest function/method, not the whole file/class. */
function enclosingFunctionBody(node: ts.Node): ts.Node | null {
  let parent = node.parent;
  while (parent) {
    if (
      ts.isArrowFunction(parent)
      || ts.isFunctionDeclaration(parent)
      || ts.isFunctionExpression(parent)
      || ts.isMethodDeclaration(parent)
      || ts.isConstructorDeclaration(parent)
      || ts.isGetAccessorDeclaration(parent)
      || ts.isSetAccessorDeclaration(parent)
    ) {
      return parent.body ?? null;
    }
    parent = parent.parent;
  }
  return null;
}

function isNegativeRepeatCount(call: ts.CallExpression): boolean {
  const count = call.arguments[1];
  if (!count) return false;
  let expr: ts.Expression = count;
  while (ts.isParenthesizedExpression(expr)) expr = expr.expression;
  if (!ts.isPrefixUnaryExpression(expr) || expr.operator !== ts.SyntaxKind.MinusToken) return false;
  let operand: ts.Expression = expr.operand;
  while (ts.isParenthesizedExpression(operand)) operand = operand.expression;
  // A dynamic negated value is conservatively treated as a potential endless loop.
  return !ts.isNumericLiteral(operand) || Number(operand.text) > 0;
}

/** Pure TS/TSX AST scan; ignores comments and strings. */
export function scanSource(text: string, file: string): LoopSite[] {
  const normalized = file.replace(/\\/g, "/");
  if (!shouldScanPath(normalized)) return [];
  const source = ts.createSourceFile(
    normalized, text, ts.ScriptTarget.Latest, true,
    normalized.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const sites: LoopSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      const kind: LoopKind | null = name === "setInterval"
        ? "setInterval"
        : name === "withRepeat" && isNegativeRepeatCount(node) ? "withRepeat" : null;
      if (kind !== null) {
        const body = enclosingFunctionBody(node);
        sites.push({
          file: normalized,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          kind,
          gated: body !== null && hasGate(body),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

/** Walk the checked-in app tree, with no globbing dependency or generated files. */
export function scanTree(root: string = ROOT): LoopSite[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(path);
      } else if (entry.isFile()) {
        const file = relative(root, path).split(sep).join("/");
        if (shouldScanPath(file)) files.push(file);
      }
    }
  };
  walk(join(root, "app", "src"));
  files.sort();
  return files.flatMap(file => scanSource(readFileSync(join(root, file), "utf8"), file));
}

/** Reject both increases (including new files) and stale, overly large allowances. */
export function checkRatchet(
  sites: readonly LoopSite[],
  allowances: Readonly<Record<string, number>>,
): string[] {
  const counts = new Map<string, number>();
  for (const site of sites) {
    if (!site.gated) counts.set(site.file, (counts.get(site.file) ?? 0) + 1);
  }
  const errors: string[] = [];
  const paths = new Set([...Object.keys(allowances), ...counts.keys()]);
  for (const file of [...paths].sort()) {
    const allowed = allowances[file] ?? 0;
    const count = counts.get(file) ?? 0;
    if (!Number.isSafeInteger(allowed) || allowed < 0) {
      errors.push(file + ": allowance must be a nonnegative integer");
    } else if (count > allowed) {
      errors.push(file + ": " + count + " ungated loop(s) exceeds allowance " + allowed);
    } else if (count < allowed) {
      errors.push(file + ": " + count + " ungated loop(s) is below allowance " + allowed
        + "; lower the number to " + count);
    }
  }
  return errors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readAllowlist(path: string): Record<string, number> {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(value)) throw new Error("Ambient loop allowlist must be a JSON object");
  const allowances: Record<string, number> = {};
  for (const [file, count] of Object.entries(value)) {
    if (!shouldScanPath(file) || typeof count !== "number"
      || !Number.isSafeInteger(count) || count < 0) {
      throw new Error("Invalid ambient loop allowance for " + file);
    }
    allowances[file] = count;
  }
  return allowances;
}

if (import.meta.main) {
  try {
    const sites = scanTree();
    const errors = checkRatchet(sites, readAllowlist(join(ROOT, "scripts", "ambient-loop-gate.allow.json")));
    console.log(JSON.stringify({ sites, errors }, null, 2));
    if (errors.length > 0) process.exitCode = 1;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
