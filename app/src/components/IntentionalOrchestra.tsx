import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FlatList, Linking, Platform, ScrollView, StyleSheet, Text, View, type ListRenderItem } from "react-native";
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { MOTION_MS } from "../motion";
import { colors, space, type } from "../theme";
import { matchesFilter, projectMap, type MapFilter, type MapKind, type MapNode, type MapRelation, type OrchestraMap } from "../lib/orchestra-map";
import { defaultView, ORCHESTRA_VIEWS, TRIAGE_LANES, viewGraph, type OrchestraView } from "../lib/orchestra-views";
import { adjacency, edgesOf, HUB_SPOKE_CAP, hubRows, lineageForest, liveConnectionCounts, type Hub } from "../lib/orchestra-adjacency";
import { PressScale } from "./PressScale";
import { useAmbientRunning, useOrbMotion } from "./OrbMotion";
import { InteractiveTile } from "./InteractiveTile";
import { Tree } from "./Tree";
import { LiveTriageList } from "./LiveTriageList";
import type { TreeNode } from "../lib/tree";

const kindColor = { chat: colors.gold, subagent: colors.orchestraSubagent, repo: colors.gold, host: colors.textMuted };
const stateColor = { idle: colors.textMuted, live: colors.information, "needs-you": colors.warn, failing: colors.danger, done: colors.textMuted };
const relationColor = { delegated: colors.gold, touched: colors.information, hosted: colors.textFaint, workspace: colors.provenance };
const legend: (MapKind | MapRelation)[] = ["chat", "subagent", "repo", "host", "delegated", "touched", "hosted", "workspace"];
/** Wire pulses per turn of the shared 6 s OrbMotion clock (~1.2 s per pulse, as the old 650 ms yoyo). */
const WIRE_BEATS = 5;
function isKind(k: MapKind | MapRelation): k is MapKind { return k === "chat" || k === "subagent" || k === "repo" || k === "host"; }
function Glyph({ kind }: { kind: MapKind | MapRelation }) {
  return isKind(kind) ? <View style={{ width: 11, height: 11, borderRadius: kind === "repo" ? 1 : 6, borderWidth: 1.5, borderColor: kindColor[kind], backgroundColor: kind === "host" ? "transparent" : kindColor[kind] }} /> : <View style={{ width: 20, height: 0, borderTopWidth: kind === "hosted" ? 1 : 2, borderColor: relationColor[kind], borderStyle: kind === "workspace" ? "dotted" : "solid" }} />;
}

/**
 * No animation of its own: an active delegated wire reads the app's one OrbMotion clock,
 * which already stops in the background and for reduced motion. Unmounting a wire
 * (every view switch) leaves no running animation behind.
 */
const Wire = memo(function Wire({ relation, active }: { relation: MapRelation; active: boolean }) {
  const { clock } = useOrbMotion();
  const pulsing = useAmbientRunning() && active && relation === "delegated";
  const animated = useAnimatedStyle(() => ({ opacity: pulsing && clock ? 0.65 + 0.35 * Math.cos(clock.value * Math.PI * 2 * WIRE_BEATS) : 1 }), [pulsing, clock]);
  return <Animated.View style={[{ width: 18, height: 24, borderLeftWidth: relation === "hosted" ? 1 : 2, borderBottomWidth: relation === "hosted" ? 1 : 2, borderColor: relationColor[relation], borderStyle: relation === "workspace" ? "dotted" : "solid", marginLeft: 10 }, animated]} />;
});

const OrchestraCard = memo(function OrchestraCard({ node, compact = false, dim, focused, onFocus, onFeedback }: {
  node: MapNode; compact?: boolean; dim: boolean; focused: boolean; onFocus(id: string): void; onFeedback?(node: MapNode): void;
}) {
  const open = useCallback(() => onFocus(node.id), [onFocus, node.id]);
  const extraActions = useMemo(() => onFeedback ? [{ id: "feedback", label: "Feedback", run: () => onFeedback(node) }] : [], [onFeedback, node]);
  const style = useMemo(() => [styles.card, compact && styles.compact, { opacity: dim ? 0.4 : 1, borderColor: node.collision || node.state === "failing" ? colors.danger : focused ? colors.gold : colors.border }, node.collision && styles.collision], [compact, dim, focused, node.collision, node.state]);
  return <InteractiveTile title={node.label} summary={`${node.kind}: ${node.label}, ${node.state}. ${node.reason || ""}`} onOpen={open} extraActions={extraActions} style={style}>
    <View style={styles.row}><Glyph kind={node.kind} /><Text style={styles.label} numberOfLines={2}>{node.label}</Text><Text style={[styles.state, { color: stateColor[node.state] }]}>{node.kind === "host" ? node.online === false ? "offline" : "online" : node.state === "needs-you" ? "needs you" : node.state}</Text></View>
    {node.kind === "repo" ? <Text style={styles.meta} numberOfLines={2}>{node.branch || "branch unknown"} · {node.dirty === undefined ? "dirty unknown" : `${node.dirty} dirty`} · {node.collision ? "W1 COLLISION" : node.reason}</Text> : null}
    {node.kind === "host" ? <Text style={styles.meta}>{node.health || "Health unavailable"}</Text> : null}
    {!compact && node.kind !== "host" && node.kind !== "repo" ? <><Text style={styles.meta} numberOfLines={2}>{node.reason || "No live state reported"}</Text><Text style={styles.action} numberOfLines={2}>→ {node.action || TRIAGE_LANES.find(l => l.state === node.state)?.action}</Text></> : null}
  </InteractiveTile>;
});

type Lane = (typeof TRIAGE_LANES)[number];
type Row =
  | { key: string; kind: "lane-head"; lane: Lane; count: number }
  | { key: string; kind: "lane-card"; lane: Lane; node: MapNode; last: boolean }
  | { key: string; kind: "lane-empty"; lane: Lane }
  | { key: string; kind: "hub"; hub: Hub }
  | { key: string; kind: "lineage" }
  | { key: string; kind: "card"; node: MapNode }
  | { key: string; kind: "note"; text: string };

/** Latest-value ref so memoized children get stable callbacks from inline parent props. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export function OrchestraGraph({ graph, width: _width, children, actions, fixture = false, error, warnings = [], onOpen, onFeedback, canOpen, triageHeader }: { triageHeader?: ReactNode; graph: OrchestraMap; width: number; children?: ReactNode; actions?: ReactNode; fixture?: boolean; error?: string; warnings?: string[]; onOpen?(node: MapNode): void; onFeedback?(node: MapNode): void; canOpen?(node: MapNode): boolean }) {
  const [view, setView] = useState<OrchestraView>(() => defaultView(graph.nodes));
  const [chosen, setChosen] = useState(false);
  const [filter, setFilter] = useState<MapFilter | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusOnly, setFocusOnly] = useState(false);
  const [expandedHubs, setExpandedHubs] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => { if (!chosen) setView(defaultView(graph.nodes)); }, [graph, chosen]);
  // Retain completed-worker evidence for historical counts, but never mount its title
  // in a card, tree or detail sheet (even in an offscreen retained pager pane).
  const displayGraph = useMemo((): OrchestraMap => {
    const nodes = graph.nodes.filter(node => node.kind !== "subagent" || node.state !== "done");
    const ids = new Set(nodes.map(node => node.id));
    return { nodes, edges: graph.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)) };
  }, [graph]);
  const current = useMemo(() => viewGraph(displayGraph, view), [displayGraph, view]);
  const recordedCurrent = useMemo(() => viewGraph(graph, view), [graph, view]);
  const projected = useMemo(() => projectMap(current, filter, focusId, focusOnly), [current, filter, focusId, focusOnly]);
  const adj = useMemo(() => adjacency(projected), [projected]);
  const currentAdj = useMemo(() => adjacency(current), [current]);
  const graphAdj = useMemo(() => adjacency(displayGraph), [displayGraph]);
  const selected = focusId ? graphAdj.byId.get(focusId) : undefined;
  const latestFeedback = useLatest(onFeedback);
  const feedback = useCallback((node: MapNode) => latestFeedback.current?.(node), [latestFeedback]);
  const onCardFeedback = onFeedback ? feedback : undefined;
  const focus = useCallback((id: string) => setFocusId(id), []);

  const fade = useSharedValue(1);
  useEffect(() => () => cancelAnimation(fade), [fade]);
  const transition = useAnimatedStyle(() => ({ opacity: fade.value }));
  const switchView = useCallback((next: OrchestraView) => {
    cancelAnimation(fade);
    fade.value = 0.5; setView(next); setChosen(true); setFilter(null); setFocusId(null); setFocusOnly(false);
    fade.value = withTiming(1, { duration: MOTION_MS.exit });
  }, [fade]);
  const dimmed = useCallback((node: MapNode) => !matchesFilter(node, current, filter) || node.online === false, [current, filter]);

  const lineage = useMemo(() => view !== "lineage" ? [] : lineageForest(projected, adj, (node, kids): TreeNode => ({
    id: node.id, label: node.label, kind: node.kind === "repo" ? "repo" : node.kind === "host" ? "host" : "session",
    meta: node.state, detail: `${node.parentId ? "delegated · " : ""}${node.reason || "No live state reported"}`,
    shimmer: node.state === "live", dimmed: !matchesFilter(node, current, filter),
    onPress: () => setFocusId(node.id), children: kids,
  })), [view, projected, adj, current, filter]);
  const lineageExpanded = useMemo(() => projected.nodes.map(n => n.id), [projected]);

  const rows = useMemo((): Row[] => {
    const out: Row[] = [];
    if (view === "triage") {
      for (const lane of TRIAGE_LANES) {
        const nodes = projected.nodes.filter(n => n.state === lane.state);
        out.push({ key: `lane:${lane.state}`, kind: "lane-head", lane, count: nodes.length });
        if (!nodes.length) out.push({ key: `lane-empty:${lane.state}`, kind: "lane-empty", lane });
        nodes.forEach((node, i) => out.push({ key: `lane:${lane.state}:${node.id}`, kind: "lane-card", lane, node, last: i === nodes.length - 1 }));
      }
    } else if (view === "lineage") {
      out.push({ key: "lineage", kind: "lineage" });
    } else {
      const live = liveConnectionCounts(adj);
      const hubs = view === "fleet"
        ? hubRows(adj, "host", hub => adj.outEdges.get(hub.id) ?? [], live)
        : hubRows(adj, "repo", hub => adj.inEdges.get(hub.id) ?? [], live);
      for (const hub of hubs) out.push({ key: `hub:${hub.hub.id}`, kind: "hub", hub });
    }
    if (filter?.only && isKind(filter.kind) && ((view === "fleet" && filter.kind !== "host") || (view === "work" && filter.kind !== "repo"))) {
      for (const node of projected.nodes) out.push({ key: `only:${node.id}`, kind: "card", node });
    }
    if (!projected.nodes.length) out.push({ key: "empty", kind: "note", text: `No ${view === "lineage" ? "recorded delegation" : "matching evidence"} in this snapshot. No relationships inferred.` });
    for (const n of graph.nodes) if (n.grouped) out.push({ key: `grouped:${n.id}`, kind: "note", text: `${n.label} · ${n.reason}` });
    return out;
  }, [view, projected, adj, filter, graph]);

  const toggleHub = useCallback((id: string) => setExpandedHubs(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  }), []);

  const renderRow: ListRenderItem<Row> = ({ item }) => {
    switch (item.kind) {
      case "lane-head": return <View style={[styles.lane, { borderLeftColor: stateColor[item.lane.state] }]}><Text style={[styles.heading, { color: stateColor[item.lane.state] }]}>{item.lane.title} · {item.count}</Text></View>;
      case "lane-empty": return <View style={[styles.lane, styles.laneEnd, { borderLeftColor: stateColor[item.lane.state] }]}><Text style={styles.meta}>Nothing here</Text></View>;
      case "lane-card": return <View style={[styles.lane, item.last && styles.laneEnd, { borderLeftColor: stateColor[item.lane.state] }]}><OrchestraCard node={item.node} dim={dimmed(item.node)} focused={focusId === item.node.id} onFocus={focus} onFeedback={onCardFeedback} /></View>;
      case "card": return <View style={styles.item}><OrchestraCard node={item.node} dim={dimmed(item.node)} focused={focusId === item.node.id} onFocus={focus} onFeedback={onCardFeedback} /></View>;
      case "note": return <Text style={item.key === "empty" ? [styles.meta, styles.item] : styles.hint}>{item.text}</Text>;
      case "lineage": return <View style={styles.item}><Text style={styles.heading}>Delegation tree · {projected.edges.length} recorded links</Text><Tree inline label="Recorded delegation" nodes={lineage} initialExpanded={lineageExpanded} /></View>;
      case "hub": {
        const { hub, edges, children: spokes, live } = item.hub;
        const expanded = expandedHubs.has(hub.id);
        const shown = expanded ? spokes : spokes.slice(0, HUB_SPOKE_CAP);
        const hidden = spokes.length - shown.length;
        return <View style={[styles.hub, styles.item]}>
          <OrchestraCard node={hub} dim={dimmed(hub)} focused={focusId === hub.id} onFocus={focus} onFeedback={onCardFeedback} />
          <Text style={styles.meta}>{spokes.length} sessions · {live} live{hub.collision ? " · ONE OWNER PER WORKTREE" : ""}</Text>
          <View style={styles.spokes}>{shown.map(node => <View key={node.id} style={styles.spoke}><View style={styles.row}>{edges.filter(e => e.from === node.id || e.to === node.id).map(e => <Wire key={e.id} relation={e.relation} active={e.active} />)}</View><OrchestraCard node={node} compact dim={dimmed(node)} focused={focusId === node.id} onFocus={focus} onFeedback={onCardFeedback} /></View>)}</View>
          {hidden > 0 || (expanded && spokes.length > HUB_SPOKE_CAP) ? <PressScale accessibilityRole="button" accessibilityLabel={expanded ? `Show fewer sessions on ${hub.label}` : `Show ${hidden} more sessions on ${hub.label}`} onPress={() => toggleHub(hub.id)} style={styles.more}><Text style={styles.action}>{expanded ? "Show fewer" : `+${hidden} more`}</Text></PressScale> : null}
          {!spokes.length ? <Text style={styles.meta}>No sessions reported on this host</Text> : null}
        </View>;
      }
    }
  };

  const summary = useMemo(() => {
    let live = 0, needs = 0, hosts = 0;
    for (const n of graph.nodes) { if (n.state === "live" && n.kind !== "repo") live++; if (n.state === "needs-you") needs++; if (n.kind === "host") hosts++; }
    return `${live} live · ${needs} need you · ${hosts} hosts`;
  }, [graph]);
  const legendItems = useMemo(() => legend.map(kind => {
    const items = isKind(kind) ? recordedCurrent.nodes.filter(n => n.kind === kind) : recordedCurrent.edges.filter(e => e.relation === kind);
    const live = isKind(kind) ? recordedCurrent.nodes.filter(n => n.kind === kind && n.state === "live").length : recordedCurrent.edges.filter(e => e.relation === kind && e.active).length;
    return { kind, count: items.length, live };
  }).filter(item => item.count > 0), [recordedCurrent]);
  const telemetry = useMemo(() => view !== "fleet" ? [] : current.nodes.filter(n => n.kind === "host").map(host => ({
    host, live: (currentAdj.outEdges.get(host.id) ?? []).filter(e => currentAdj.byId.get(e.to)?.state === "live").length,
  })), [view, current, currentAdj]);

  const header = <>
    {children}
    {view === "fleet" ? <View style={[styles.telemetry, styles.item]}>{telemetry.map(({ host, live }) => <PressScale key={host.id} onPress={() => { setFocusId(host.id); setFocusOnly(true); }} style={[styles.telemetryRow, host.online === false && { opacity: 0.4, minHeight: 26 }]}><View style={styles.row}><Glyph kind="host" /><Text style={styles.label}>{host.label}</Text><Text style={styles.meta}>{host.online === false ? "offline · " : ""}{live} live</Text></View>{host.online !== false ? <Text style={styles.meta}>{host.health || host.reason}</Text> : null}</PressScale>)}</View> : null}
  </>;

  return <View style={styles.root} testID="orchestra-graph">
    {view !== "triage" ? <Text style={styles.summary}>{summary}</Text> : null}
    <View style={styles.tabs}>{ORCHESTRA_VIEWS.map(mode => <PressScale key={mode.id} accessibilityRole="button" accessibilityLabel={mode.title} accessibilityState={{ selected: view === mode.id }} onPress={() => switchView(mode.id)} style={[styles.tab, view === mode.id && styles.tabOn]}><Text style={[styles.tabTitle, view === mode.id && { color: colors.gold }]}>{mode.title}</Text><Text style={styles.subtitle}>{mode.subtitle}</Text></PressScale>)}</View>
    <Text style={styles.hint}>{fixture ? "Fixture · not live" : view === "triage" ? "Live priority sources · source ages shown" : "Read-only host evidence · last 24h"} · Tap a label to inspect</Text>
    {view !== "triage" && error ? <Text accessibilityRole="alert" style={styles.warning}>{error}</Text> : null}
    {view !== "triage" && warnings.length ? <Text style={styles.warning}>{warnings.join(" · ")}</Text> : null}
    {view === "work" ? <Text style={styles.hint}>{current.nodes.filter(n => n.collision).length} W1 collisions · {current.nodes.filter(n => n.kind !== "repo" && n.state === "live").length} live sessions changing worktrees</Text> : null}
    {view === "triage" ? <Text style={styles.hint}>Tap a priority to open its evidence and next action.</Text> : null}
    <Animated.View style={[styles.body, transition]}>
      {view === "triage" ? <>{triageHeader}<LiveTriageList /></> : <FlatList
        testID="orchestra-list"
        data={rows}
        keyExtractor={row => row.key}
        renderItem={renderRow}
        extraData={{ focusId, expandedHubs, dimmed }}
        ListHeaderComponent={header}
        contentContainerStyle={styles.content}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews={Platform.OS === "android"}
      />}
    </Animated.View>
    {view !== "triage" ? <View style={styles.legend} accessibilityLabel="Graph legend. Tap to highlight, hold to show only.">{legendItems.map(({ kind, count, live }) => <PressScale key={kind} accessibilityRole="button" accessibilityLabel={`Legend ${kind}`} accessibilityHint="Tap to highlight; long press to show only" onPress={() => setFilter(filter?.kind === kind ? null : { kind, only: false })} onLongPress={() => { setFilter({ kind, only: true }); setFocusOnly(false); }} style={[styles.legendItem, filter?.kind === kind && styles.tabOn]}><Glyph kind={kind} /><Text style={styles.meta}>{kind} {count} · {live} live</Text></PressScale>)}</View> : null}
    <View style={styles.footer}>{view !== "triage" ? <><PressScale onPress={() => { setFocusOnly(!focusOnly); }} style={styles.button}><Text style={styles.meta}>{focusOnly ? "All" : "Focus"}</Text></PressScale><PressScale onPress={() => { setFilter(null); setFocusOnly(false); setFocusId(null); }} style={styles.button}><Text style={styles.meta}>Reset</Text></PressScale></> : null}{actions}</View>
    {selected ? <View style={styles.sheet} accessibilityLabel="Node details"><ScrollView><Text style={styles.heading}>{selected.label}</Text><Text style={styles.meta}>{selected.kind} · {selected.state} · {selected.harness}{selected.model ? ` · ${selected.model}` : ""}</Text><Text style={styles.label}>{selected.reason || "No live state reported"}</Text><Text style={styles.action}>→ {selected.action || TRIAGE_LANES.find(l => l.state === selected.state)?.action}</Text><Text selectable style={styles.meta}>{selected.path}{selected.branch ? ` · ${selected.branch}` : ""}</Text><Text style={styles.meta}>Parent: {(selected.parentId ? graphAdj.byId.get(selected.parentId)?.label : undefined) || "None recorded"}</Text><Text style={styles.meta}>Children: {edgesOf(graphAdj, selected.id).filter(e => e.from === selected.id && e.relation === "delegated").map(e => graphAdj.byId.get(e.to)?.label).join(", ") || "None recorded"}</Text><Text selectable style={styles.meta}>{selected.provenance?.join("\n")}</Text><View style={styles.row}>{onOpen && selected.sessionId && (!canOpen || canOpen(selected)) ? <PressScale onPress={() => onOpen(selected)} style={styles.button}><Text style={styles.action}>Open chat</Text></PressScale> : null}{selected.path?.startsWith("https://github.com/") ? <PressScale onPress={() => void Linking.openURL(selected.path!)} style={styles.button}><Text style={styles.action}>Open PR</Text></PressScale> : null}<PressScale onPress={() => setFocusId(null)} style={styles.button}><Text style={styles.action}>Close</Text></PressScale></View></ScrollView></View> : null}
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 }, summary: { color: colors.text, ...type.body, paddingHorizontal: 16, paddingVertical: 8 },
  tabs: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, gap: 6 }, tab: { width: "48%", minHeight: 60, alignItems: "flex-start", padding: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border }, tabOn: { backgroundColor: colors.surfaceRaised, borderColor: colors.goldLo }, tabTitle: { color: colors.text, ...type.label }, subtitle: { color: colors.textMuted, fontSize: 10, marginTop: 3 },
  hint: { color: colors.textMuted, fontSize: 10, paddingHorizontal: 16, paddingVertical: 8 }, warning: { color: colors.warn, fontSize: 11, paddingHorizontal: 16, paddingBottom: 4 }, body: { flex: 1, minHeight: 100 }, content: { padding: 14, paddingBottom: 30 },
  item: { marginBottom: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 }, label: { color: colors.text, fontSize: 12, lineHeight: 17, flexShrink: 1, flex: 1 }, state: { fontSize: 10 }, meta: { color: colors.textMuted, fontSize: 10, lineHeight: 15 }, action: { color: colors.gold, fontSize: 11, lineHeight: 16 }, heading: { color: colors.text, ...type.label, marginBottom: 8 },
  card: { padding: 10, borderRadius: 8, borderWidth: 1, backgroundColor: colors.surface, gap: 5, alignItems: "stretch" }, compact: { minHeight: 64, flex: 1 }, collision: { backgroundColor: "#2b1015", shadowColor: colors.danger, shadowOpacity: 0.6, shadowRadius: 10 },
  telemetry: { gap: 4, paddingBottom: 10, borderBottomWidth: 1, borderColor: colors.border }, telemetryRow: { alignItems: "stretch", padding: 4, minHeight: 36 },
  lane: { borderLeftWidth: 2, paddingLeft: 10, paddingBottom: 8 }, laneEnd: { marginBottom: 14 }, hub: { gap: 6 }, spokes: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, spoke: { width: "48%" },
  more: { minHeight: 44, alignItems: "flex-start", paddingHorizontal: 6 },
  legend: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, borderTopWidth: 1, borderColor: colors.border }, legendItem: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 38, paddingHorizontal: 6, borderRadius: 6 },
  footer: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.md, gap: 10 }, button: { minHeight: 44, paddingHorizontal: 10 },
  sheet: { position: "absolute", bottom: 70, left: 12, right: 12, maxHeight: "65%", padding: 16, backgroundColor: colors.surfaceRaised, borderRadius: 12, borderWidth: 1, borderColor: colors.goldLo, gap: 8 },
});
