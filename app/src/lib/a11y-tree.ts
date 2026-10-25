import type { TreeNode } from "./tree";

/** These sentinels are created by Tree's lazy child loader, not server data. */
export type TreePlaceholder = "loading" | "error" | null;
export type TreeActivation = "press" | "toggle" | "select" | null;
export type TreeAccessibleActionTarget = "toggle" | "longpress" | null;

export interface TreeAccessibilityContext {
  selected: boolean;
  expanded: boolean;
  pendingChildren?: boolean;
  placeholder?: TreePlaceholder;
}

interface TreeAccessibilityAction {
  name: "expand" | "collapse" | "longpress";
  label?: string;
}

export interface TreeRowAccessibility {
  label: string;
  hint?: string;
  role: "button" | "text";
  state: {
    selected: boolean;
    expanded?: boolean;
    busy?: boolean;
    disabled?: boolean;
  };
  actions: TreeAccessibilityAction[];
  disabled: boolean;
}

/** Recognize only Tree's exact internally generated child markers. */
export function treePlaceholderFor(
  node: TreeNode,
  parentId: string | undefined,
  parentPending: boolean,
): TreePlaceholder {
  if (!parentId || node.kind !== "note") return null;
  if (parentPending && node.id === `${parentId}:loading` && node.label === "Loading…") return "loading";
  if (node.id === `${parentId}:error` && node.label === "Could not load children") return "error";
  return null;
}

/** Touch and accessibility use the same real node action; inert notes have none. */
export function treeRowTarget(node: TreeNode, placeholder: TreePlaceholder = null): TreeActivation {
  if (placeholder === "loading") return null;
  if (node.onPress) return "press";
  if (node.children) return "toggle";
  if (node.kind === "note" && !node.onLongPress) return null;
  return "select";
}

export function treeRowAccessibility(
  node: TreeNode,
  { selected, expanded, pendingChildren = false, placeholder = null }: TreeAccessibilityContext,
): TreeRowAccessibility {
  const target = treeRowTarget(node, placeholder);
  const disabled = target === null;
  const busy = pendingChildren || placeholder === "loading";
  const name = node.label.trim() || `Unnamed ${node.kind}`;
  const parts: Array<string | undefined> = [
    name,
    node.meta,
    node.status,
    node.detail,
    pendingChildren ? "Loading children" : undefined,
    placeholder === "error" && node.onPress ? "Retry available" : undefined,
  ];
  const label = parts.filter((part): part is string => typeof part === "string" && part.trim().length > 0).join(", ");
  const actions: TreeAccessibilityAction[] = [];

  // If opening the node and disclosing its children are different actions,
  // Tree renders one separately labelled disclosure button instead.
  if (!placeholder && node.children && !node.onPress) actions.push({ name: expanded ? "collapse" : "expand" });
  if (!placeholder && node.onLongPress) actions.push({ name: "longpress", label: `More actions for ${name}` });

  const hint = placeholder === "error"
    ? (node.onPress ? "Retry loading children" : undefined)
    : target === "press" ? "Open this item"
    : target === "toggle" ? (expanded ? "Collapse children" : "Expand children")
    : target === "select" ? "Select this item" : undefined;

  return {
    label,
    hint,
    role: disabled ? "text" : "button",
    state: {
      selected: selected && !disabled,
      ...(node.children ? { expanded } : {}),
      ...(busy ? { busy: true } : {}),
      ...(disabled ? { disabled: true } : {}),
    },
    actions,
    disabled,
  };
}

/**
 * Reject stale or unsupported screen-reader actions. In particular, asking
 * to collapse an already-collapsed row must never collapse its parent.
 */
export function treeRowA11yAction(
  node: TreeNode,
  expanded: boolean,
  actionName: string,
  placeholder: TreePlaceholder = null,
): TreeAccessibleActionTarget {
  if (placeholder) return null;
  if (actionName === "longpress") return node.onLongPress ? "longpress" : null;
  if (node.children && !node.onPress) {
    if (actionName === "expand" && !expanded) return "toggle";
    if (actionName === "collapse" && expanded) return "toggle";
  }
  return null;
}
