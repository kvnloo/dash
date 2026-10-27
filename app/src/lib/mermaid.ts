export interface Diagram {
  direction: "TB" | "LR" | "BT" | "RL";
  nodes: { id: string; label: string; detail?: string }[];
  edges: { id: string; source: string; target: string; label?: string }[];
}
/** Supported Mermaid subset, intentionally not a permissive repair parser. Unknown syntax stays code. */
export function parseMermaid(source: string): Diagram | null {
  if (source.length > 32000) return null;
  const lines = source.replace(/%%[^\n]*/g, "").split(/[;\n]/).map(s => s.trim()).filter(Boolean);
  const header = lines.shift() ?? "";
  const flow = /^(flowchart|graph)\s+(TD|TB|LR|BT|RL)$/.exec(header);
  const state = /^stateDiagram(?:-v2)?$/.test(header);
  if (!flow && !state) return null;
  const direction = flow?.[2] === "LR" ? "LR" : flow?.[2] === "RL" ? "RL" : flow?.[2] === "BT" ? "BT" : "TB";
  const result: Diagram = { direction, nodes: [], edges: [] };
  function node(raw: string, ending = false): string | null {
    if (raw === "[*]") raw = ending ? "__end" : "__start";
    const match = /^([A-Za-z_][\w-]*)(?:\[([^\]\n]*)\]|\(([^)\n]*)\)|\{([^}\n]*)\})?$/.exec(raw.trim());
    if (!match?.[1]) return null;
    const id = match[1];
    const explicit = match[2] ?? match[3] ?? match[4];
    const label = (explicit ?? (id === "__start" ? "Start" : id === "__end" ? "End" : id)).replace(/^"(.*)"$/, "$1");
    const existing = result.nodes.find(n => n.id === id);
    if (!existing) result.nodes.push({ id, label });
    else if (explicit !== undefined) existing.label = label;
    return id;
  }
  for (const line of lines) {
    if (state) {
      const alias = /^state\s+"([^"]+)"\s+as\s+([A-Za-z_][\w-]*)$/.exec(line);
      if (alias?.[2]) { const id = node(alias[2]); const n = result.nodes.find(n => n.id === id); if (n) n.label = alias[1] ?? alias[2]; continue; }
      const detail = /^([A-Za-z_][\w-]*)\s*:\s*(.+)$/.exec(line);
      if (detail?.[1]) { const id = node(detail[1]); const n = result.nodes.find(n => n.id === id); if (n) n.detail = detail[2]; continue; }
    }
    const parts = line.split(/\s*(-->|---|==>|-\.->)(?:\|([^|]*)\|)?\s*/);
    if (parts.length === 1) { if (!node(line)) return null; continue; }
    let previous = node(parts[0] ?? "");
    if (!previous) return null;
    for (let i = 1; i < parts.length; i += 3) {
      let target = parts[i + 2] ?? "";
      let label = parts[i + 1];
      if (state) { const colon = target.indexOf(":"); if (colon >= 0) { label = target.slice(colon + 1).trim(); target = target.slice(0, colon).trim(); } }
      const next = node(target, true);
      if (!next) return null;
      result.edges.push({ id: `e${result.edges.length}`, source: previous, target: next, ...(label ? { label } : {}) });
      previous = next;
    }
    if (result.nodes.length > 80 || result.edges.length > 120) return null;
  }
  return result.nodes.length && result.nodes.length <= 80 ? result : null;
}
