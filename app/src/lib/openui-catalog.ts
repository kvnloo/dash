import { createLibrary, createStreamingParser, defineComponent, type ElementNode } from "@openuidev/lang-core";
import { z } from "zod";

// Pure presentation catalog: the language is parsed, never evaluated or executed.
const text = z.string().max(2000);
const Stack = defineComponent({
  name: "Stack",
  props: z.object({ children: z.array(z.unknown()) }),
  description: "Vertical stack of presentation components.",
  component: null,
});
const Card = defineComponent({
  name: "Card",
  props: z.object({ title: text, children: z.array(z.unknown()) }),
  description: "Titled presentation card with child components.",
  component: null,
});
const Text = defineComponent({
  name: "Text",
  props: z.object({ value: text, tone: text.optional() }),
  description: "Read-only text.",
  component: null,
});
const Stat = defineComponent({
  name: "Stat",
  props: z.object({ label: text, value: z.union([text, z.number()]) }),
  description: "Read-only key metric.",
  component: null,
});
const Progress = defineComponent({
  name: "Progress",
  props: z.object({ label: text, value: z.number().min(0).max(1) }),
  description: "Read-only progress from zero to one.",
  component: null,
});
const List = defineComponent({
  name: "List",
  props: z.object({ items: z.array(text) }),
  description: "Read-only list of strings.",
  component: null,
});
const Table = defineComponent({
  name: "Table",
  props: z.object({ columns: z.array(text), rows: z.array(z.array(text)) }),
  description: "Read-only table with string cells.",
  component: null,
});
const Callout = defineComponent({
  name: "Callout",
  props: z.object({ tone: text, text }),
  description: "Read-only informational callout.",
  component: null,
});
const Roadmap = defineComponent({
  name: "Roadmap",
  props: z.object({ handle: z.string() }),
  description: "Approved local snapshot handle only.",
  component: null,
});
const schema = createLibrary({
  root: "Stack",
  components: [Stack, Card, Text, Stat, Progress, List, Table, Callout, Roadmap],
}).toJSONSchema();

export type OpenUINode =
  | { type: "Stack"; children: OpenUINode[] }
  | { type: "Card"; title: string; children: OpenUINode[] }
  | { type: "Text"; value: string; tone?: string }
  | { type: "Stat"; label: string; value: string | number }
  | { type: "Progress"; label: string; value: number }
  | { type: "List"; items: string[] }
  | { type: "Table"; columns: string[]; rows: string[][] }
  | { type: "Callout"; tone: string; text: string }
  | { type: "Roadmap"; handle: "dash-roadmap" };

export type OpenUIParseResult =
  | { state: "loading" }
  | { state: "invalid"; reason: string }
  | { state: "ready"; tree: OpenUINode };

const MAX_SOURCE_BYTES = 16 * 1024;
const MAX_NODES = 200;
const MAX_DEPTH = 8;
const MAX_STRING = 2000;
const MAX_TABLE_ROWS = 50;
const COMPONENTS = new Set(["Stack", "Card", "Text", "Stat", "Progress", "List", "Table", "Callout", "Roadmap"]);
const ROADMAP_SOURCE = /^\s*root\s*=\s*Roadmap\(\s*"dash-roadmap"\s*\)\s*;?\s*$/;

function invalid(reason: string): OpenUIParseResult {
  return { state: "invalid", reason };
}

// Count UTF-8 bytes without depending on a native TextEncoder polyfill.
function sourceBytes(source: string): number {
  let bytes = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);
    if (c < 0x80) bytes++;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const next = source.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return Infinity;
      bytes += 4;
    } else if (c >= 0xdc00 && c <= 0xdfff) return Infinity;
    else bytes += 3;
    if (bytes > MAX_SOURCE_BYTES) return bytes;
  }
  return bytes;
}

/**
 * Strict syntax preflight. The upstream parser intentionally recovers from bad
 * tokens, supports arithmetic, actions, queries, and auto-closes broken input.
 * Only static literals, arrays, component calls, and statement references
 * reach it here; no recovered or silently ignored source may be published.
 */
function staticProgram(source: string): boolean {
  let at = 0;
  let statements = 0;
  const ids = new Set<string>();
  const skipSpace = () => {
    while (at < source.length && /\s/.test(source[at])) at++;
  };
  const skipInlineSpace = () => {
    while (at < source.length && (source[at] === " " || source[at] === "\t")) at++;
  };
  const name = (): string | null => {
    const start = at;
    if (!/[A-Za-z_]/.test(source[at] ?? "")) return null;
    at++;
    while (at < source.length && /[A-Za-z0-9_]/.test(source[at])) at++;
    return source.slice(start, at);
  };
  const stringLiteral = (): boolean => {
    const start = at++;
    while (at < source.length) {
      const current = source[at++];
      if (current === "\\") {
        if (at >= source.length) return false;
        at++;
      } else if (current === '"') {
        try {
          const value: unknown = JSON.parse(source.slice(start, at));
          return typeof value === "string" && value.length <= MAX_STRING;
        } catch {
          return false;
        }
      }
    }
    return false;
  };
  const value = (depth: number): boolean => {
    if (depth > 48) return false;
    skipSpace();
    if (source[at] === '"') return stringLiteral();
    if (source[at] === "[") {
      at++;
      skipSpace();
      if (source[at] === "]") { at++; return true; }
      while (at < source.length) {
        if (!value(depth + 1)) return false;
        skipSpace();
        if (source[at] === "]") { at++; return true; }
        if (source[at] !== ",") return false;
        at++;
        skipSpace();
        if (source[at] === "]") { at++; return true; }
      }
      return false;
    }
    const numeric = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(source.slice(at));
    if (numeric) { at += numeric[0].length; return true; }
    const id = name();
    if (!id) return false;
    if (id === "true" || id === "false" || id === "null") return true;
    const afterName = at;
    skipInlineSpace();
    if (source[at] !== "(") { at = afterName; return true; }
    if (!COMPONENTS.has(id)) return false;
    at++;
    skipSpace();
    if (source[at] === ")") { at++; return true; }
    while (at < source.length) {
      if (!value(depth + 1)) return false;
      skipSpace();
      if (source[at] === ")") { at++; return true; }
      if (source[at] !== ",") return false;
      at++;
      skipSpace();
      if (source[at] === ")") { at++; return true; }
    }
    return false;
  };
  skipSpace();
  while (at < source.length) {
    const id = name();
    if (!id || ids.has(id) || ++statements > MAX_NODES) return false;
    ids.add(id);
    skipInlineSpace();
    if (source[at] !== "=") return false;
    at++;
    if (!value(0)) return false;
    let separated = false;
    while (at < source.length && /\s/.test(source[at])) {
      if (source[at] === "\n" || source[at] === "\r") separated = true;
      at++;
    }
    if (source[at] === ";") {
      at++;
      separated = true;
    }
    skipSpace();
    if (at < source.length && !separated) return false;
  }
  return ids.has("root");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function element(value: unknown): value is ElementNode {
  return record(value) && value.type === "element" && typeof value.typeName === "string"
    && value.partial === false && record(value.props);
}
function short(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_STRING;
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(short);
}
function propsOf(node: ElementNode, required: string[], optional: string[] = []): boolean {
  return required.every(key => Object.hasOwn(node.props, key))
    && Object.keys(node.props).every(key => required.includes(key) || optional.includes(key));
}

type DecodeBudget = { nodes: number; failure: string };
function decode(value: unknown, depth: number, budget: DecodeBudget, source: string): OpenUINode | null {
  const fail = (reason: string): null => {
    budget.failure = reason;
    return null;
  };
  if (!element(value)) return fail("Non-component or incomplete child");
  if (depth > MAX_DEPTH) return fail("Component depth exceeds 8");
  if (++budget.nodes > MAX_NODES) return fail("Component count exceeds 200");
  const p = value.props;
  const childrenOf = (): OpenUINode[] | null => {
    if (!Array.isArray(p.children)) return fail("Children must be an array");
    const result: OpenUINode[] = [];
    for (const child of p.children) {
      const parsed = decode(child, depth + 1, budget, source);
      if (!parsed) return null;
      result.push(parsed);
    }
    return result;
  };
  switch (value.typeName) {
    case "Stack": {
      if (!propsOf(value, ["children"])) return fail("Invalid Stack props");
      const children = childrenOf();
      return children ? { type: "Stack", children } : null;
    }
    case "Card": {
      if (!propsOf(value, ["title", "children"]) || !short(p.title)) return fail("Invalid Card props");
      const children = childrenOf();
      return children ? { type: "Card", title: p.title, children } : null;
    }
    case "Text": {
      if (!propsOf(value, ["value"], ["tone"]) || !short(p.value)
        || (p.tone !== undefined && !short(p.tone))) return fail("Invalid Text props");
      return { type: "Text", value: p.value, ...(p.tone === undefined ? {} : { tone: p.tone }) };
    }
    case "Stat":
      if (!propsOf(value, ["label", "value"]) || !short(p.label)
        || !(short(p.value) || (typeof p.value === "number" && Number.isFinite(p.value)))) return fail("Invalid Stat props");
      return { type: "Stat", label: p.label, value: p.value };
    case "Progress":
      if (!propsOf(value, ["label", "value"]) || !short(p.label)
        || typeof p.value !== "number" || !Number.isFinite(p.value)
        || p.value < 0 || p.value > 1) return fail("Progress must be between 0 and 1");
      return { type: "Progress", label: p.label, value: p.value };
    case "List":
      if (!propsOf(value, ["items"]) || !strings(p.items) || p.items.length > MAX_NODES) return fail("Invalid List items");
      return { type: "List", items: p.items };
    case "Table": {
      if (!propsOf(value, ["columns", "rows"]) || !strings(p.columns)
        || p.columns.length === 0 || p.columns.length > MAX_TABLE_ROWS
        || !Array.isArray(p.rows) || p.rows.length > MAX_TABLE_ROWS) return fail("Invalid Table dimensions");
      const rows: string[][] = [];
      for (const row of p.rows) {
        if (!strings(row) || row.length !== p.columns.length) return fail("Table rows must match columns");
        rows.push(row);
      }
      return { type: "Table", columns: p.columns, rows };
    }
    case "Callout":
      if (!propsOf(value, ["tone", "text"]) || !short(p.tone) || !short(p.text)) return fail("Invalid Callout props");
      return { type: "Callout", tone: p.tone, text: p.text };
    case "Roadmap":
      // Match openui-roadmap.ts byte-for-byte in the handle/source gate.
      if (!propsOf(value, ["handle"]) || p.handle !== "dash-roadmap"
        || depth !== 1 || !ROADMAP_SOURCE.test(source)) return fail("Unapproved Roadmap handle or source");
      return { type: "Roadmap", handle: "dash-roadmap" };
    default:
      return fail("Unknown component");
  }
}

export function parseOpenUI(source: string, complete: boolean): OpenUIParseResult {
  if (sourceBytes(source) > MAX_SOURCE_BYTES) return invalid("Source exceeds 16 KiB");
  if (!complete) return { state: "loading" };
  if (!staticProgram(source)) return invalid("Invalid or dynamic OpenUI syntax");
  try {
    const parsed = createStreamingParser(schema, "Stack").set(source, true);
    if (!parsed.root || parsed.root.partial || parsed.rootExpression || parsed.meta.incomplete
      || parsed.meta.errors.length || parsed.meta.unresolved.length || parsed.meta.orphaned.length
      || parsed.meta.statementCount > MAX_NODES || parsed.queryStatements.length
      || parsed.mutationStatements.length || Object.keys(parsed.stateDeclarations).length
      || parsed.root.hasDynamicProps) return invalid("Unresolved, dynamic, or invalid OpenUI program");
    const budget: DecodeBudget = { nodes: 0, failure: "Invalid component tree" };
    const tree = decode(parsed.root, 1, budget, source);
    return tree ? { state: "ready", tree } : invalid(budget.failure);
  } catch {
    return invalid("OpenUI parser rejected source");
  }
}
