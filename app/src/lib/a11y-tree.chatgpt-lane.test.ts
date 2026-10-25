import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  treePlaceholderFor,
  treeRowA11yAction,
  treeRowAccessibility,
  treeRowTarget,
} from "./a11y-tree";
import type { TreeNode } from "./tree";

const folder: TreeNode = {
  id: "host:1",
  kind: "host",
  label: "groot",
  meta: "2 bots · 1 chat",
  status: "running",
  detail: "Tailnet machine",
  children: () => [],
};

describe("tree accessibility labels and states", () => {
  test("folder identity, metadata, status, selection, and truthful disclosure state", () => {
    const collapsed = treeRowAccessibility(folder, { selected: false, expanded: false });
    expect(collapsed.label).toBe("groot, 2 bots · 1 chat, running, Tailnet machine");
    expect(collapsed.role).toBe("button");
    expect(collapsed.hint).toBe("Expand children");
    expect(collapsed.state).toEqual({ selected: false, expanded: false });
    expect(collapsed.actions).toEqual([{ name: "expand" }]);
    expect(collapsed.disabled).toBe(false);

    const expanded = treeRowAccessibility(folder, { selected: true, expanded: true });
    expect(expanded.state).toEqual({ selected: true, expanded: true });
    expect(expanded.hint).toBe("Collapse children");
    expect(expanded.actions).toEqual([{ name: "collapse" }]);
    expect(treeRowTarget(folder)).toBe("toggle");
  });

  test("running/offline does not imply disabled, and absent metadata is not fabricated", () => {
    const offline: TreeNode = { ...folder, status: "offline", dimmed: true, meta: undefined, detail: undefined };
    const a11y = treeRowAccessibility(offline, { selected: false, expanded: false });
    expect(a11y.label).toBe("groot, offline");
    expect(a11y.state.disabled).toBeUndefined();
    expect(a11y.state.busy).toBeUndefined();
    expect(a11y.actions).toEqual([{ name: "expand" }]);
    const blank: TreeNode = { id: "blank", label: "   ", kind: "note" };
    expect(treeRowAccessibility(blank, { selected: false, expanded: false }).label).toBe("Unnamed note");
  });

  test("loaded leaf details remain readable, but inert notes are not fake buttons", () => {
    const leaf: TreeNode = { id: "result", label: "Result", kind: "output", detail: "Exit code 1" };
    const selectable = treeRowAccessibility(leaf, { selected: true, expanded: false });
    expect(selectable.label).toBe("Result, Exit code 1");
    expect(selectable.state).toEqual({ selected: true });
    expect(selectable.actions).toEqual([]);
    expect(treeRowTarget(leaf)).toBe("select");

    const note: TreeNode = { id: "empty", label: "No bots or sessions reported", kind: "note" };
    const inert = treeRowAccessibility(note, { selected: true, expanded: false });
    expect(treeRowTarget(note)).toBeNull();
    expect(inert.role).toBe("text");
    expect(inert.disabled).toBe(true);
    expect(inert.state).toEqual({ selected: false, disabled: true });
    expect(inert.hint).toBeUndefined();
    expect(inert.actions).toEqual([]);
  });

  test("loading only announces real pending children and marks loader inert/busy", () => {
    const loading: TreeNode = { id: "host:1:loading", label: "Loading…", kind: "note" };
    expect(treePlaceholderFor(loading, "host:1", true)).toBe("loading");
    expect(treePlaceholderFor(loading, "host:1", false)).toBeNull();
    expect(treePlaceholderFor(loading, "other", true)).toBeNull();
    expect(treePlaceholderFor({ ...loading, label: "Real node" }, "host:1", true)).toBeNull();

    const busy = treeRowAccessibility(folder, { selected: true, expanded: true, pendingChildren: true });
    expect(busy.label).toBe("groot, 2 bots · 1 chat, running, Tailnet machine, Loading children");
    expect(busy.state).toEqual({ selected: true, expanded: true, busy: true });
    const placeholder = treeRowAccessibility(loading, { selected: true, expanded: false, placeholder: "loading" });
    expect(placeholder.label).toBe("Loading…");
    expect(placeholder.state).toEqual({ selected: false, busy: true, disabled: true });
    expect(placeholder.role).toBe("text");
    expect(placeholder.actions).toEqual([]);
    expect(treeRowTarget(loading, "loading")).toBeNull();
  });

  test("failed lazy child reads are unavailable unless a real retry callback exists", () => {
    const error: TreeNode = { id: "host:1:error", kind: "note", label: "Could not load children" };
    expect(treePlaceholderFor(error, "host:1", false)).toBe("error");
    expect(treePlaceholderFor(error, "other", false)).toBeNull();
    const unavailable = treeRowAccessibility(error, { selected: false, expanded: false, placeholder: "error" });
    expect(unavailable.label).toBe("Could not load children");
    expect(unavailable.role).toBe("text");
    expect(unavailable.state).toEqual({ selected: false, disabled: true });
    expect(unavailable.hint).toBeUndefined();

    let retries = 0;
    const retry: TreeNode = { ...error, onPress: () => { retries++; } };
    const actionable = treeRowAccessibility(retry, { selected: false, expanded: false, placeholder: "error" });
    expect(actionable.label).toBe("Could not load children, Retry available");
    expect(actionable.role).toBe("button");
    expect(actionable.state).toEqual({ selected: false });
    expect(actionable.hint).toBe("Retry loading children");
    expect(actionable.actions).toEqual([]);
    expect(treeRowTarget(retry, "error")).toBe("press");
    retry.onPress?.();
    expect(retries).toBe(1);
  });
});

describe("accessible actions agree with touch targets", () => {
  test("folder expand/collapse toggles only when matching current state", () => {
    let expanded = false;
    let toggles = 0;
    const toggle = () => { expanded = !expanded; toggles++; };
    expect(treeRowA11yAction(folder, expanded, "collapse")).toBeNull();
    expect(treeRowA11yAction(folder, expanded, "expand")).toBe("toggle");
    if (treeRowA11yAction(folder, expanded, "expand") === "toggle") toggle();
    expect(expanded).toBe(true);
    expect(treeRowA11yAction(folder, expanded, "expand")).toBeNull();
    expect(treeRowA11yAction(folder, expanded, "collapse")).toBe("toggle");
    if (treeRowA11yAction(folder, expanded, "collapse") === "toggle") toggle();
    expect(expanded).toBe(false);
    expect(toggles).toBe(2);
    expect(treeRowA11yAction(folder, false, "decrement")).toBeNull();
    expect(treeRowA11yAction(folder, true, "activate")).toBeNull();
  });

  test("open and disclose are separate controls; accessibility cannot misroute to open", () => {
    let opened = 0;
    const session: TreeNode = { ...folder, kind: "session", onPress: () => { opened++; } };
    expect(treeRowTarget(session)).toBe("press");
    expect(treeRowAccessibility(session, { selected: true, expanded: false }).actions).toEqual([]);
    expect(treeRowA11yAction(session, false, "expand")).toBeNull();
    expect(treeRowA11yAction(session, true, "collapse")).toBeNull();
    session.onPress?.();
    expect(opened).toBe(1);
    expect(treeRowA11yAction({ id: "leaf", label: "Leaf", kind: "output" }, false, "expand")).toBeNull();
  });

  test("long press invokes the existing action only on rows that offer it", () => {
    let menus = 0;
    const host: TreeNode = { ...folder, onLongPress: () => { menus++; } };
    expect(treeRowAccessibility(host, { selected: false, expanded: false }).actions).toEqual([
      { name: "expand" }, { name: "longpress", label: "More actions for groot" },
    ]);
    expect(treeRowA11yAction(host, false, "longpress")).toBe("longpress");
    if (treeRowA11yAction(host, false, "longpress") === "longpress") host.onLongPress?.();
    expect(menus).toBe(1);
    expect(treeRowA11yAction(folder, false, "longpress")).toBeNull();
    expect(treeRowA11yAction(host, false, "longpress", "loading")).toBeNull();
  });
});

describe("Tree native/web semantics wiring", () => {
  const source = readFileSync(join(import.meta.dir, "../components/Tree.tsx"), "utf8");

  test("single row treeitem carries computed states, labels, available actions, and normal activation", () => {
    expect(source).toContain("treeRowAccessibility(node, { selected, expanded, pendingChildren, placeholder })");
    expect(source).toContain("accessibilityLabel={a11y.label}");
    expect(source).toContain("accessibilityHint={a11y.hint}");
    expect(source).toContain("accessibilityRole={a11y.role}");
    expect(source).toContain('role={Platform.OS === "web" ? "treeitem" : undefined}');
    expect(source).toContain("accessibilityState={a11y.state}");
    expect(source).toContain("accessibilityActions={a11y.actions}");
    expect(source).toContain("disabled={a11y.disabled}");
    expect(source).toContain("onPress={activate}");
    expect(source).toContain("onLongPress={longPress}");
    expect(source).toContain("testID={`tree-row-${node.id}`}");
    expect(source).toContain("aria-level={depth + 1}");
    expect(source).toContain("aria-posinset={item.getItemMeta().posInSet + 1}");
    expect(source).toContain("aria-setsize={item.getItemMeta().setSize}");
  });

  test("a11y action dispatch uses the row's actual disclosure/longpress callbacks and never parent-collapse fallback", () => {
    expect(source).toContain("treeRowA11yAction(node, expanded, e.nativeEvent.actionName, placeholder)");
    expect(source).toContain('if (action === "toggle") toggle();');
    expect(source).toContain('else if (action === "longpress") longPress?.();');
    expect(source).toContain("treeRowTarget(node, placeholder)");
    expect(source).toContain('{node.onPress && node.children ? <Pressable');
    expect(source).toContain("accessibilityState={{ expanded }}");
    expect(source).toContain("onPress={toggle}");
    expect(source).toContain("accessibilityLiveRegion={placeholder ? \"polite\" : \"none\"}");
    expect(source).toContain("pending.has(item.getId())");
    expect(source).toContain("treePlaceholderFor(");
  });

  test("retains keyboard identity, 44 DIP targets, and reduced-motion transitions", () => {
    expect(source).toContain('row: { flexDirection: "row", minHeight: controlMin + space.md }');
    expect(source).toContain("disclosure: { width: controlMin, minHeight: controlMin,");
    expect(source).toContain("ReduceMotion.System");
    expect(source).toContain("return <TreeKeyboard label={label}");
  });
});
