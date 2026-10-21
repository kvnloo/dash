import { Feather } from "@expo/vector-icons";
import { syncDataLoaderFeature, type ItemInstance } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { PanResponder, Platform, Pressable, StyleSheet, Text, View, type ViewProps } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition, ReduceMotion, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { haptic } from "../haptics";
import { childNodes, treeIndex, type TreeKind, type TreeNode } from "../lib/tree";
import { SNAP } from "../motion";
import { colors, controlMin, glass, radius, space, timing, type } from "../theme";
import { TreeKeyboard } from "./TreeKeyboard";
import { AgentOrb } from "./AgentOrb";

const icons: Record<TreeKind, ComponentProps<typeof Feather>["name"]> = {
  host: "monitor", bot: "cpu", harness: "terminal", session: "message-circle", repo: "git-branch",
  turn: "corner-down-right", thinking: "feather", tools: "tool", call: "terminal", args: "code", output: "file-text", note: "info",
};
const layout = LinearTransition.duration(timing.state).reduceMotion(ReduceMotion.System);

// Animate FlashList's positioned cell, not its inner row's global coordinates.
function TreeCell({ children, ...props }: ViewProps) {
  // RN Web's positioned cells already move when FlashList reflows; a second
  // global-coordinate layout transition double-translates them. Fade rows on web.
  return <Animated.View {...props} layout={Platform.OS === "web" ? undefined : layout}>{children}</Animated.View>;
}

function Row({ item, selected, activate, toggle, collapse, inline }: {
  inline: boolean; item: ItemInstance<TreeNode>; selected: boolean; activate(): void; toggle(): void; collapse(): void;
}) {
  const node = item.getItemData();
  const expanded = item.isExpanded();
  const depth = item.getItemMeta().level;
  const rotation = useSharedValue(expanded ? 90 : 0);
  useEffect(() => { rotation.value = withSpring(expanded ? 90 : 0, { ...SNAP, reduceMotion: ReduceMotion.System }); }, [expanded, rotation]);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));
  const swipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dx < -space.xxl && Math.abs(g.dy) < space.md,
    onPanResponderRelease: (_, g) => { if (g.dx < -space.xxxl) collapse(); },
  }), [collapse]);
  return (
    <Animated.View layout={inline ? layout : undefined} entering={FadeIn.delay(timing.state).duration(timing.immediate).reduceMotion(ReduceMotion.System)} exiting={FadeOut.duration(timing.immediate).reduceMotion(ReduceMotion.System)} {...swipe.panHandlers}>
      <View style={[styles.row, node.dimmed && styles.dimmed]}>
        {Array.from({ length: depth }, (_, level) => <View pointerEvents="none" key={level} style={[styles.guide, { left: space.md + level * space.lg }]} />)}
        <Pressable
          testID={`tree-row-${node.id}`}
          accessibilityRole="button"
          role={Platform.OS === "web" ? "treeitem" : "button"}
          accessibilityLabel={`${node.label}${node.meta ? `, ${node.meta}` : ""}${node.status ? `, ${node.status}` : ""}`}
          accessibilityState={{ selected, ...(node.children ? { expanded } : {}) }}
          aria-level={depth + 1}
          aria-posinset={item.getItemMeta().posInSet + 1}
          aria-setsize={item.getItemMeta().setSize}
          aria-expanded={node.children ? expanded : undefined}
          accessibilityActions={node.children ? [{ name: "expand" }, { name: "collapse" }] : []}
          onAccessibilityAction={e => { if (e.nativeEvent.actionName === "expand" && !expanded) toggle(); if (e.nativeEvent.actionName === "collapse") collapse(); }}
          onPress={activate}
          onLongPress={node.onLongPress ? () => { haptic.select(); node.onLongPress?.(); } : undefined}
          style={({ pressed }) => [styles.content, { paddingLeft: space.xs + depth * space.lg }, (selected || pressed) && styles.selected]}
        >
          <View style={styles.chevronSpace}>{node.children && <Animated.View style={chevron}><Feather name="chevron-right" size={space.md} color={colors.textTertiary} /></Animated.View>}</View>
          {node.thinking ? <AgentOrb thinking={node.thinking} size={20} label={`Session ${node.thinking.phase}`} /> : <Feather name={icons[node.kind]} size={space.lg} color={expanded ? colors.accent : colors.textMuted} />}
          <View style={styles.label}>
            <Text style={[node.kind === "host" ? type.heading : type.small, styles.text]} numberOfLines={node.kind === "call" ? 2 : 1}>{node.label}</Text>
            {node.detail ? <Text style={styles.detail} numberOfLines={node.kind === "args" || node.kind === "output" || node.kind === "thinking" ? undefined : 1} selectable>{node.detail}</Text> : null}
          </View>
          {node.meta ? <Text style={styles.meta}>{node.meta}</Text> : null}
          {node.status ? <View style={[styles.dot, { backgroundColor: node.status === "running" ? colors.accent : node.status === "offline" ? colors.textFaint : colors.textTertiary }]} /> : null}
        </Pressable>
        {node.onPress && node.children ? <Pressable accessibilityRole="button" accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${node.label}`} onPress={toggle} style={styles.disclosure}><Feather name={expanded ? "minus" : "plus"} size={space.md} color={colors.textMuted} /></Pressable> : null}
      </View>
    </Animated.View>
  );
}

/** Headless Tree state only: DOM props/hotkeys/DnD are deliberately not mounted in RN. */
export function Tree({ nodes, label = "Tree", initialExpanded = [], inline = false }: {
  nodes: TreeNode[]; label?: string; initialExpanded?: string[]; inline?: boolean;
}) {
  const source = useMemo(() => treeIndex(nodes), [nodes]);
  const loaded = useMemo(() => new Map<string, TreeNode[]>(), [source]);
  const pending = useMemo(() => new Set<string>(), [source]);
  const alive = useRef(true);
  const list = useRef<FlashListRef<ItemInstance<TreeNode>>>(null);
  const [selected, setSelected] = useState<string>();
  const [, refresh] = useState(0);
  const tree = useTree<TreeNode>({
    rootItemId: source.root.id,
    initialState: { expandedItems: initialExpanded },
    getItemName: item => item.getItemData().label,
    isItemFolder: item => Boolean(item.getItemData().children),
    dataLoader: {
      getItem: id => source.index.get(id) ?? source.root,
      getChildren: id => {
        const node = source.index.get(id);
        if (!node) return [];
        let children = loaded.get(id);
        if (!children && !pending.has(id)) {
          try {
            const result = childNodes(node);
            if (result instanceof Promise) {
              pending.add(id);
              const loading: TreeNode = { id: `${id}:loading`, label: "Loading…", kind: "note" };
              children = [loading];
              const finish = (items: TreeNode[]) => {
                if (!alive.current) return;
                loaded.set(id, items); pending.delete(id);
                for (const child of items) source.index.set(child.id, child);
                refresh(n => n + 1);
              };
              void result.then(finish, () => finish([{ id: `${id}:error`, label: "Could not load children", kind: "note", onPress: () => { loaded.delete(id); refresh(n => n + 1); } }]));
            } else children = result;
          } catch { children = [{ id: `${id}:error`, label: "Could not load children", kind: "note" }]; }
          loaded.set(id, children ?? []);
        }
        for (const child of children ?? []) source.index.set(child.id, child);
        return (children ?? []).map(child => child.id);
      },
    },
    features: [syncDataLoaderFeature],
  });
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // Roster refreshes and async child completion must invalidate the flattened visible list.
  useEffect(() => { tree.rebuildTree(); }, [source, loaded, tree]);
  tree.scheduleRebuildTree();
  const items = tree.getItems();
  const toggle = (item: ItemInstance<TreeNode>) => { list.current?.prepareForLayoutAnimationRender(); haptic.select(); item.isExpanded() ? item.collapse() : item.expand(); };
  const activate = (item: ItemInstance<TreeNode>) => {
    setSelected(item.getId());
    if (item.getItemData().onPress) { haptic.select(); item.getItemData().onPress?.(); }
    else toggle(item);
  };
  const render = (item: ItemInstance<TreeNode>) => <Row key={item.getId()} inline={inline} item={item} selected={selected === item.getId()} activate={() => activate(item)} toggle={() => toggle(item)} collapse={() => { haptic.select(); (item.isExpanded() ? item : item.getParent())?.collapse(); }} />;
  const focus = (item: ItemInstance<TreeNode> | undefined) => {
    if (!item || item.getId() === source.root.id) return;
    list.current?.scrollToIndex({ index: item.getItemMeta().index, animated: false });
    return item.getId();
  };
  return <TreeKeyboard label={label} inline={inline} onKey={(key, id) => {
    const index = items.findIndex(item => item.getId() === id);
    const item = items[index];
    if (!item) return;
    if (key === "ArrowRight") { if (item.isFolder() && !item.isExpanded()) toggle(item); else return focus(items[index + 1]); }
    if (key === "ArrowLeft") { if (item.isExpanded()) toggle(item); else return focus(item.getParent()); }
    if (key === "ArrowDown") return focus(items[index + 1]);
    if (key === "ArrowUp") return focus(items[index - 1]);
    if (key === "Home") return focus(items[0]);
    if (key === "End") return focus(items[items.length - 1]);
  }}>
    {inline ? items.map(render) : <FlashList ref={list} CellRendererComponent={TreeCell} data={items} keyExtractor={item => item.getId()} getItemType={item => item.getItemData().kind} renderItem={({ item }) => render(item)} contentContainerStyle={styles.list} ListEmptyComponent={<Text style={styles.detail}>No hosts yet. Pair with a computer to see its bots and sessions.</Text>} />}
  </TreeKeyboard>;
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.lg, paddingBottom: space.scene + space.xxxl },
  row: { flexDirection: "row", minHeight: controlMin + space.md },
  content: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.sm, paddingRight: space.sm, borderRadius: radius.sm },
  chevronSpace: { width: space.lg, alignItems: "center" },
  guide: { position: "absolute", top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: glass.border },
  selected: { backgroundColor: glass.fillChipOn },
  label: { flex: 1, minWidth: 0 }, text: { color: colors.text },
  detail: { ...type.mono, color: colors.textTertiary }, meta: { ...type.mono, color: colors.textTertiary, flexShrink: 1 },
  dot: { width: space.sm, height: space.sm, borderRadius: radius.pill },
  dimmed: { opacity: 0.48 }, disclosure: { width: controlMin, alignItems: "center", justifyContent: "center" },
});
