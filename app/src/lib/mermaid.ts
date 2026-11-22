export interface Diagram {
  direction: "TB" | "LR" | "BT" | "RL";
  nodes: { id: string; label: string; detail?: string }[];
  edges: { id: string; source: string; target: string; label?: string }[];
}

// Node shapes, longest delimiters first so `((x))` is not read as `(` around `(x)`.
const SHAPES: readonly (readonly [string, string])[] = [
  ["(((", ")))"], ["((", "))"], ["([", "])"], ["[[", "]]"], ["[(", ")]"], ["{{", "}}"],
  ["[/", "/]"], ["[\\", "\\]"], ["[/", "\\]"], ["[\\", "/]"],
  ["[", "]"], ["(", ")"], ["{", "}"], [">", "]"],
];
// Styling and metadata lines change how a diagram looks, never what it says.
const DECORATION = /^(classDef|class|style|linkStyle|click|direction|accTitle|accDescr)\b/;
const ARROW = /\s*(<?-{2,}>|<?={2,}>|<?-\.+->|-{3,}|={3,}|--[ox]|-\.-)(?:\|([^|]*)\|)?\s*/g;
// `A -- text --> B` and `A -. text .-> B` are the same labelled edge as `A -->|text| B`.
const TEXT_EDGE = /\s(--|==|-\.)\s+([^|>]+?)\s+(-->|==>|\.->)\s*/g;

const unquote = (text: string) => text.trim().replace(/^"(.*)"$/, "$1");

/** Split `A & B[x & y]` on the ampersands outside labels. */
function splitGroup(raw: string): string[] {
  const out: string[] = [];
  let depth = 0, quoted = false, current = "";
  for (const ch of raw) {
    if (ch === "\"") quoted = !quoted;
    else if (!quoted && "[({".includes(ch)) depth++;
    else if (!quoted && "])}".includes(ch)) depth--;
    if (ch === "&" && !quoted && depth <= 0) { out.push(current); current = ""; continue; }
    current += ch;
  }
  out.push(current);
  return out;
}

/** Supported Mermaid subset (flowchart/graph and stateDiagram) with the node shapes, edge labels,
 * `&` fan-out, subgraph grouping and styling lines real models write. Not a repair parser: any
 * line outside this subset makes the whole block null, so it stays readable code. */
export function parseMermaid(source: string): Diagram | null {
  if (source.length > 32000) return null;
  const lines = source.replace(/%%[^\n]*/g, "").split(/[;\n]/).map(s => s.trim()).filter(Boolean);
  const header = lines.shift() ?? "";
  const flow = /^(flowchart|graph)\s+(TD|TB|LR|BT|RL)$/.exec(header);
  const state = /^stateDiagram(?:-v2)?$/.test(header);
  if (!flow && !state) return null;
  const direction = flow?.[2] === "LR" ? "LR" : flow?.[2] === "RL" ? "RL" : flow?.[2] === "BT" ? "BT" : "TB";
  const result: Diagram = { direction, nodes: [], edges: [] };
  function node(input: string, ending = false): string | null {
    let raw = input.trim();
    if (raw === "[*]") raw = ending ? "__end" : "__start";
    const head = /^([A-Za-z_][\w-]*)(?::::[\w-]+)?/.exec(raw);
    if (!head?.[1]) return null;
    const id = head[1];
    const rest = raw.slice(head[0].length).replace(/:::[\w-]+$/, "");
    let explicit: string | undefined;
    if (rest) {
      const shape = SHAPES.find(([open, close]) => rest.length >= open.length + close.length && rest.startsWith(open) && rest.endsWith(close));
      if (!shape) return null;
      explicit = rest.slice(shape[0].length, rest.length - shape[1].length);
    }
    const label = unquote(explicit ?? (id === "__start" ? "Start" : id === "__end" ? "End" : id)).replace(/<br\s*\/?>/gi, " ");
    const existing = result.nodes.find(n => n.id === id);
    if (!existing) result.nodes.push({ id, label });
    else if (explicit !== undefined) existing.label = label;
    return id;
  }
  function group(raw: string, ending = false): string[] | null {
    const ids = splitGroup(raw).map(part => node(part, ending));
    return ids.every((id): id is string => id !== null) ? ids : null;
  }
  for (const text of lines) {
    if (DECORATION.test(text)) continue;
    // Subgraphs are drawn flat: their nodes and edges still count, the box does not.
    if (/^subgraph\b/.test(text) || text === "end") continue;
    const line = flow ? text.replace(TEXT_EDGE, (_m, _open: string, label: string, close: string) => ` ${close === "==>" ? "==>" : close === ".->" ? "-.->" : "-->"}|${label}| `) : text;
    if (state) {
      const alias = /^state\s+"([^"]+)"\s+as\s+([A-Za-z_][\w-]*)$/.exec(line);
      if (alias?.[2]) { const id = node(alias[2]); const n = result.nodes.find(n => n.id === id); if (n) n.label = alias[1] ?? alias[2]; continue; }
      const detail = /^([A-Za-z_][\w-]*)\s*:\s*(.+)$/.exec(line);
      if (detail?.[1]) { const id = node(detail[1]); const n = result.nodes.find(n => n.id === id); if (n) n.detail = detail[2]; continue; }
    }
    const parts = line.split(ARROW);
    if (parts.length === 1) { if (!group(line)) return null; continue; }
    let previous = group(parts[0] ?? "");
    if (!previous) return null;
    for (let i = 1; i < parts.length; i += 3) {
      let target = parts[i + 2] ?? "";
      let label = parts[i + 1] === undefined ? undefined : unquote(parts[i + 1] ?? "");
      if (state) { const colon = target.indexOf(":"); if (colon >= 0) { label = target.slice(colon + 1).trim(); target = target.slice(0, colon).trim(); } }
      const next = group(target, true);
      if (!next) return null;
      for (const from of previous) for (const to of next) {
        result.edges.push({ id: `e${result.edges.length}`, source: from, target: to, ...(label ? { label } : {}) });
      }
      previous = next;
    }
    if (result.nodes.length > 80 || result.edges.length > 120) return null;
  }
  return result.nodes.length && result.nodes.length <= 80 ? result : null;
}
