/**
 * Structural copy of the bounded presentation tree specified in #439.
 * Keep this local until Hermes wires the sibling parser into GenerativeBlock.
 * No executable props, actions, URLs or network-backed nodes are represented.
 */
export type OpenUINode =
  | { type: "Stack"; children: OpenUINode[] }
  | { type: "Card"; title: string; children: OpenUINode[] }
  | { type: "Text"; value: string; tone?: string }
  | { type: "Stat"; label: string; value: string | number }
  | { type: "Progress"; label: string; value: number }
  | { type: "List"; items: string[] }
  | { type: "Table"; columns: string[]; rows: string[][] }
  | { type: "Callout"; tone: string; text: string }
  | { type: "Roadmap"; handle: string };

type RowBase = {
  /** Stable positional identity; content changes do not change row keys. */
  key: string;
  parentKey: string | null;
  depth: number;
  accessibilityLabel: string;
};

export type OpenUILayoutRow = RowBase & (
  | { type: "Stack" }
  | { type: "Card"; title: string }
  | { type: "Text"; value: string; tone?: string }
  | { type: "Stat"; label: string; value: string | number }
  | { type: "Progress"; label: string; value: number }
  | { type: "List"; items: string[] }
  | { type: "Table"; columns: string[]; rows: string[][] }
  | { type: "Callout"; tone: string; text: string }
  | { type: "Roadmap"; handle: string }
);

export function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Preorder, flattened rows. parentKey preserves nesting for a native-only
 * renderer without duplicating markup, and the reverse push preserves order.
 */
export function layoutModel(root: OpenUINode): OpenUILayoutRow[] {
  type Pending = { node: OpenUINode; key: string; parentKey: string | null; depth: number };
  const pending: Pending[] = [{ node: root, key: "root", parentKey: null, depth: 0 }];
  const rows: OpenUILayoutRow[] = [];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    const { node, key, parentKey, depth } = current;
    const base = { key, parentKey, depth };

    switch (node.type) {
      case "Stack":
        rows.push({ ...base, type: "Stack", accessibilityLabel: "Group" });
        break;
      case "Card":
        rows.push({ ...base, type: "Card", title: node.title, accessibilityLabel: `${node.title}, card` });
        break;
      case "Text":
        rows.push({ ...base, type: "Text", value: node.value, ...(node.tone === undefined ? {} : { tone: node.tone }), accessibilityLabel: node.value });
        break;
      case "Stat":
        rows.push({ ...base, type: "Stat", label: node.label, value: node.value, accessibilityLabel: `${node.label}: ${node.value}` });
        break;
      case "Progress": {
        const value = clampProgress(node.value);
        rows.push({ ...base, type: "Progress", label: node.label, value, accessibilityLabel: `${node.label}, ${Math.round(value * 100)} percent` });
        break;
      }
      case "List":
        rows.push({ ...base, type: "List", items: node.items, accessibilityLabel: `List, ${node.items.length} ${node.items.length === 1 ? "item" : "items"}` });
        break;
      case "Table":
        rows.push({ ...base, type: "Table", columns: node.columns, rows: node.rows, accessibilityLabel: `Table, ${node.columns.length} ${node.columns.length === 1 ? "column" : "columns"}, ${node.rows.length} ${node.rows.length === 1 ? "row" : "rows"}` });
        break;
      case "Callout":
        rows.push({ ...base, type: "Callout", tone: node.tone, text: node.text, accessibilityLabel: `${node.tone} callout: ${node.text}` });
        break;
      case "Roadmap":
        rows.push({ ...base, type: "Roadmap", handle: node.handle, accessibilityLabel: "Roadmap" });
        break;
    }

    if (node.type === "Stack" || node.type === "Card") {
      for (let i = node.children.length - 1; i >= 0; i--) {
        pending.push({ node: node.children[i], key: `${key}/${i}`, parentKey: key, depth: depth + 1 });
      }
    }
  }

  return rows;
}
