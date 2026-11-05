/** Deliberately small, bounded data grammar. Never evaluate model source. */
export type Widget = {
  type: "card" | "stat" | "table" | "progress" | "choices" | "buttons" | "checklist" | "timeline";
  title: string;
  text?: string;
  value?: string | number;
  columns?: string[];
  rows?: string[][];
  items?: { id: string; label: string; detail?: string; checked?: boolean }[];
  children?: Widget[];
  id?: string;
};
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const short = (v: unknown): v is string => typeof v === "string" && v.length <= 2000;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 12 && v.every(short);
export function parseGenUI(source: string): Widget[] | null {
  if (source.length > 64000) return null;
  let count = 0;
  function widget(v: unknown, depth: number): Widget | null {
    if (++count > 80 || depth > 5 || !record(v) || !short(v.title)) return null;
    const kind = v.type;
    if (kind !== "card" && kind !== "stat" && kind !== "table" && kind !== "progress" && kind !== "choices" && kind !== "buttons" && kind !== "checklist" && kind !== "timeline") return null;
    if (Object.keys(v).some(k => !["type", "title", "text", "value", "columns", "rows", "items", "children", "id"].includes(k))) return null;
    if (v.text !== undefined && !short(v.text)) return null;
    if (v.value !== undefined && !(short(v.value) || (typeof v.value === "number" && Number.isFinite(v.value)))) return null;
    if (kind === "progress" && (typeof v.value !== "number" || v.value < 0 || v.value > 100)) return null;
    if (v.id !== undefined && !(typeof v.id === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(v.id))) return null;
    if ((kind === "choices" || kind === "buttons" || kind === "checklist") && !v.id) return null;
    if (v.columns !== undefined && !strings(v.columns)) return null;
    if (v.rows !== undefined && !(Array.isArray(v.rows) && v.rows.length <= 40 && v.rows.every(strings))) return null;
    const columnCount = strings(v.columns) ? v.columns.length : 0;
    if (kind === "table" && (!columnCount || !Array.isArray(v.rows) || !v.rows.every(r => strings(r) && r.length === columnCount))) return null;
    let items: Widget["items"];
    if (v.items !== undefined) {
      if (!Array.isArray(v.items) || v.items.length > 24) return null;
      items = [];
      for (const item of v.items) {
        if (!record(item) || !short(item.id) || !item.id || item.id.length > 200 || !short(item.label) || (item.detail !== undefined && !short(item.detail)) || (item.checked !== undefined && typeof item.checked !== "boolean")) return null;
        if (items.some(i => i.id === item.id)) return null;
        items.push({ id: item.id, label: item.label, ...(short(item.detail) ? { detail: item.detail } : {}), ...(typeof item.checked === "boolean" ? { checked: item.checked } : {}) });
      }
    }
    if (["choices", "buttons", "checklist", "timeline"].includes(kind) && !items?.length) return null;
    let children: Widget[] | undefined;
    if (v.children !== undefined) {
      if (kind !== "card" || !Array.isArray(v.children) || v.children.length > 24) return null;
      children = [];
      for (const child of v.children) { const parsed = widget(child, depth + 1); if (!parsed) return null; children.push(parsed); }
    }
    return { type: kind, title: v.title, ...(short(v.text) ? { text: v.text } : {}), ...(typeof v.value === "string" || typeof v.value === "number" ? { value: v.value } : {}), ...(typeof v.id === "string" ? { id: v.id } : {}), ...(strings(v.columns) ? { columns: v.columns } : {}), ...(Array.isArray(v.rows) && v.rows.every(strings) ? { rows: v.rows } : {}), ...(items ? { items } : {}), ...(children ? { children } : {}) };
  }
  try {
    const v: unknown = JSON.parse(source);
    if (!record(v) || v.version !== 1 || !Array.isArray(v.components) || v.components.length > 24 || Object.keys(v).some(k => k !== "version" && k !== "components")) return null;
    const result: Widget[] = [];
    for (const item of v.components) { const parsed = widget(item, 0); if (!parsed) return null; result.push(parsed); }
    return result;
  } catch { return null; }
}

export function sandboxHTML(source: string): string {
  // First policy wins; model meta tags cannot loosen it. No scripting, navigation, forms or network.
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'; connect-src 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#0c0c0a;color:#ece8df;font:16px system-ui;margin:16px;overflow-wrap:anywhere}*{box-sizing:border-box}img{max-width:100%}</style></head><body>${source}</body></html>`;
}
export const isImageRef = (url: string) => /^(https?:\/\/[^\s<>]+|\/(?!\/)[^\s<>]+)\.(png|jpe?g|webp|gif|avif)(\?[^\s<>]*)?$/i.test(url);
