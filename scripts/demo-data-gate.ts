#!/usr/bin/env bun
/**
 * DF-117: dependency-free runtime demo/debug import ratchet.
 *
 * Run: bun scripts/demo-data-gate.ts [--json]
 * This is a source-level boundary check, not proof of on-device behaviour.
 * Static imports are deliberately reported even if their imported functions
 * also have internal guards: loading a module can itself run module code.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

export const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

export type UseSite = { line: number; guarded: boolean };
export type RuntimeImport = {
  file: string;
  line: number;
  specifier: string;
  names: string[];
  sites: UseSite[];
  guarded: boolean;
};
export type Allowlist = { allowedImporters: string[] };
export type GateReport = {
  ok: boolean;
  imports: RuntimeImport[];
  newImporters: RuntimeImport[];
  staleAllowlist: string[];
  unguardedAllowed: RuntimeImport[];
};

type CapturedImport = {
  entry: RuntimeImport;
  bindings: string[];
  direct: boolean;
};

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

export function isScannable(file: string): boolean {
  if (file === "app/App.tsx") return true;
  if (!file.startsWith("app/src/") || !/\.tsx?$/.test(file) || /\.d\.ts$/.test(file)) return false;
  const parts = file.slice("app/src/".length).split("/");
  if (parts.some(part => part === "" || part === "." || part === ".."
    || part === "mock" || part === "debug" || part === "__tests__"
    || part === "test" || part === "tests")) return false;
  return !/\.(?:test|spec)\.tsx?$/.test(file);
}

function isSeedSpecifier(specifier: string): boolean {
  return specifier.split(/[\\/]/).some(part => part === "mock" || part === "debug");
}

function positiveFlag(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node)) return positiveFlag(node.expression);
  if (ts.isIdentifier(node)) return node.text === "__DEV__" || /^isDemo(?:$|[A-Z_]\w*$)/.test(node.text);
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    return /^isDemo(?:$|[A-Z_]\w*$)/.test(node.expression.text);
  }
  // Both sides must be true for an && expression to enter its body.
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return positiveFlag(node.left) || positiveFlag(node.right);
  }
  return false;
}

/** A real enclosing positive guard, starting no more than five lines before the use. */
function guardedAt(node: ts.Node, source: ts.SourceFile): boolean {
  const useLine = lineOf(source, node);
  let child: ts.Node = node;
  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (useLine - lineOf(source, parent) > 5) continue;
    if (ts.isIfStatement(parent) && child === parent.thenStatement && positiveFlag(parent.expression)) {
      return true;
    }
    if (ts.isBinaryExpression(parent)
      && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      && child === parent.right && positiveFlag(parent.left)) {
      return true;
    }
    if (ts.isConditionalExpression(parent) && child === parent.whenTrue && positiveFlag(parent.condition)) {
      return true;
    }
  }
  return false;
}

function runtimeReference(identifier: ts.Identifier): boolean {
  let child: ts.Node = identifier;
  for (let parent = identifier.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isImportDeclaration(parent) || ts.isImportEqualsDeclaration(parent)
      || ts.isExportDeclaration(parent)) return false;
    if (ts.isTypeNode(parent)) return false;
    if (ts.isPropertyAccessExpression(parent) && child === parent.name) return false;
    if (ts.isPropertyAssignment(parent) && child === parent.name) return false;
    if (ts.isVariableDeclaration(parent) && child === parent.name) return false;
    if (ts.isParameter(parent) && child === parent.name) return false;
    if (ts.isFunctionDeclaration(parent) && child === parent.name) return false;
    if (ts.isBindingElement(parent) && child === parent.name) return false;
  }
  return true;
}

function uniqueSites(sites: readonly UseSite[]): UseSite[] {
  const seen = new Set<string>();
  return sites.filter(site => {
    const key = site.line + ":" + site.guarded;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.line - b.line || Number(a.guarded) - Number(b.guarded));
}

export function scanSource(file: string, text: string): RuntimeImport[] {
  if (!isScannable(file)) return [];
  const source = ts.createSourceFile(
    file, text, ts.ScriptTarget.Latest, true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const captures: CapturedImport[] = [];

  function capture(node: ts.Node, specifier: string, names: string[], bindings: string[]): void {
    if (!isSeedSpecifier(specifier) || names.length === 0) return;
    captures.push({
      entry: { file, line: lineOf(source, node), specifier, names, sites: [], guarded: false },
      bindings,
      direct: bindings.length === 0,
    });
  }

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      const names: string[] = [];
      const bindings: string[] = [];
      if (clause?.name) {
        names.push("default as " + clause.name.text);
        bindings.push(clause.name.text);
      }
      if (clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          names.push("* as " + clause.namedBindings.name.text);
          bindings.push(clause.namedBindings.name.text);
        } else {
          for (const item of clause.namedBindings.elements) {
            if (item.isTypeOnly) continue;
            const imported = item.propertyName?.text ?? item.name.text;
            names.push(imported === item.name.text ? imported : imported + " as " + item.name.text);
            bindings.push(item.name.text);
          }
        }
      }
      // import "x" and import {} from "x" may evaluate the target on load.
      if (!clause || (clause.namedBindings && ts.isNamedImports(clause.namedBindings)
        && clause.namedBindings.elements.length === 0)) {
        names.push("(side effect)");
      }
      capture(statement, statement.moduleSpecifier.text, names, bindings);
    } else if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly
      && ts.isExternalModuleReference(statement.moduleReference)
      && statement.moduleReference.expression
      && ts.isStringLiteral(statement.moduleReference.expression)) {
      capture(statement, statement.moduleReference.expression.text,
        ["require as " + statement.name.text], [statement.name.text]);
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly
      && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      const names: string[] = [];
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const item of statement.exportClause.elements) {
          if (!item.isTypeOnly) names.push(item.propertyName?.text ?? item.name.text);
        }
      } else if (statement.exportClause && ts.isNamespaceExport(statement.exportClause)) {
        names.push("* as " + statement.exportClause.name.text);
      } else if (!statement.exportClause) {
        names.push("*");
      }
      capture(statement, statement.moduleSpecifier.text, names, []);
    }
  }

  // Find runtime identifier use sites, plus literal dynamic import/require calls.
  // A type annotation or re-export of a type cannot create runtime seed rows.
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && runtimeReference(node)) {
      for (const item of captures) {
        if (item.bindings.includes(node.text)) {
          item.entry.sites.push({ line: lineOf(source, node), guarded: guardedAt(node, source) });
        }
      }
    }
    if (ts.isCallExpression(node)) {
      const argument = node.arguments[0];
      const isDynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if ((isDynamic || isRequire) && argument && ts.isStringLiteral(argument)) {
        const specifier = argument.text;
        if (isSeedSpecifier(specifier)) {
          const line = lineOf(source, node);
          const guarded = guardedAt(node, source);
          captures.push({
            entry: {
              file, line, specifier,
              names: [isDynamic ? "(dynamic import)" : "(require)"],
              sites: [{ line, guarded }], guarded,
            },
            bindings: [],
            direct: true,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);

  for (const item of captures) {
    if (item.direct && item.entry.sites.length === 0) {
      item.entry.sites.push({ line: item.entry.line, guarded: false });
    }
    if (item.entry.sites.length === 0) {
      // An unused static value import can still evaluate its module.
      item.entry.sites.push({ line: item.entry.line, guarded: false });
    }
    item.entry.sites = uniqueSites(item.entry.sites);
    item.entry.guarded = item.entry.sites.every(site => site.guarded);
  }
  return captures.map(item => item.entry)
    .sort((a, b) => a.line - b.line || a.specifier.localeCompare(b.specifier));
}

export function scanTree(root: string): RuntimeImport[] {
  const srcRoot = join(root, "app", "src");
  const files: string[] = [];
  const appEntry = join(root, "app", "App.tsx");
  if (existsSync(appEntry)) files.push(appEntry);
  function visit(dir: string): void {
    for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, item.name);
      if (item.isDirectory()) {
        if (!["mock", "debug", "__tests__", "test", "tests"].includes(item.name)) visit(path);
      } else if (item.isFile() && /\.tsx?$/.test(item.name)) {
        const name = relative(root, path).split(sep).join("/");
        if (isScannable(name)) files.push(path);
      }
    }
  }
  visit(srcRoot);
  return files.flatMap(path => {
    const file = relative(root, path).split(sep).join("/");
    return scanSource(file, readFileSync(path, "utf8"));
  }).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export function parseAllowlist(raw: string): Allowlist {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || !("allowedImporters" in value) || Object.keys(value).length !== 1
    || !Array.isArray(value.allowedImporters)) {
    throw new Error("invalid demo-data allowlist: expected { allowedImporters: string[] }");
  }
  const files: string[] = [];
  for (const candidate of value.allowedImporters) {
    if (typeof candidate !== "string" || !isScannable(candidate)) {
      throw new Error("invalid demo-data allowlist file: " + String(candidate));
    }
    if (files.includes(candidate)) throw new Error("duplicate demo-data allowlist file: " + candidate);
    files.push(candidate);
  }
  return { allowedImporters: files };
}

export function checkRatchet(imports: readonly RuntimeImport[], allowlist: Allowlist): GateReport {
  const allowed = new Set(allowlist.allowedImporters);
  const current = new Set(imports.map(item => item.file));
  const newImporters = imports.filter(item => !allowed.has(item.file));
  const staleAllowlist = allowlist.allowedImporters.filter(file => !current.has(file)).sort();
  const unguardedAllowed = imports.filter(item => allowed.has(item.file) && !item.guarded);
  return {
    ok: newImporters.length === 0 && staleAllowlist.length === 0 && unguardedAllowed.length === 0,
    imports: [...imports],
    newImporters,
    staleAllowlist,
    unguardedAllowed,
  };
}

export function formatReport(report: GateReport): string {
  const lines = ["demo-data gate: " + (report.ok ? "PASS" : "FAIL")
    + " (" + report.imports.length + " runtime imports, "
    + report.imports.filter(item => item.guarded).length + " guarded)"];
  for (const item of report.imports) {
    const siteLines = item.sites.map(site => site.line + (site.guarded ? " guarded" : " UNGUARDED"));
    lines.push(item.file + ":" + item.line + " " + item.specifier
      + " [" + item.names.join(", ") + "] -> " + siteLines.join(", "));
  }
  for (const item of report.newImporters) {
    lines.push("NEW IMPORTER (ratchet regression): " + item.file + ":" + item.line);
  }
  for (const file of report.staleAllowlist) {
    lines.push("SHRINK ALLOWLIST (removed runtime importer): " + file);
  }
  for (const item of report.unguardedAllowed) {
    lines.push("UNGUARDED ALLOWED IMPORT: " + item.file + ":" + item.line
      + " use lines " + item.sites.filter(site => !site.guarded).map(site => site.line).join(", "));
  }
  return lines.join("\n");
}

export function runGate(root: string): GateReport {
  const raw = readFileSync(join(root, "scripts", "demo-data-gate.allow.json"), "utf8");
  return checkRatchet(scanTree(root), parseAllowlist(raw));
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== "--json")) {
      throw new Error("Usage: bun scripts/demo-data-gate.ts [--json]");
    }
    const report = runGate(ROOT);
    console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : formatReport(report));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "Demo-data gate failed");
    process.exitCode = 1;
  }
}
