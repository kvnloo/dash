import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import type { RootStackParamList } from "../../navigation";
import {
  DESK_PANELS, LEFT_WIDTH, RIGHT_WIDTH, URL_DESK_CHOICE, clampWidth, deskDecision, deskFocus, deskPrefs, deskState,
  focusDeskPanel, loadDeskPrefs, setPanelCollapsed, updateDeskPrefs, type DeskPanelId,
} from "../../lib/desk";
import { DEX_OFF, getState as getDexState, subscribe as subscribeDex, type DexState } from "../../lib/dex";
import { PaneSizeProvider } from "../../lib/pane-size";
import { approvals, actionable } from "../../store/approvals";
import { setActive, store } from "../../store/app";
import { ChatsPane } from "../../screens/panes/ChatsPane";
import { WorkspaceActions } from "../WorkspaceHeader";
import { DeskSplitter, useDomElement, useFocusFlash } from "./DeskPanel";
import { DeskBuildPanel, DeskHostsPanel, DeskNeedsPanel, DeskPhoneQueuePanel, DeskTracesPanel, DeskWorkersPanel } from "./DeskPanels";
import { colors, fonts, radius, space, type } from "../../theme";

type Nav = NavigationProp<RootStackParamList>;
/** Panels that live in the right column, in their scroll order. */
const SIDE: readonly DeskPanelId[] = ["needs", "hosts", "phones", "workers", "traces", "build"];
const RAIL_ICON: Record<DeskPanelId, string> = { hosts: "▤", chats: "☰", orchestra: "◎", phones: "▯", workers: "⚙", needs: "!", traces: "∿", build: "#", chat: "✎" };

function useDexState(): DexState {
  const [state, setState] = useState<DexState>(DEX_OFF);
  useEffect(() => {
    const off = subscribeDex(setState);
    void getDexState().then(setState, () => {});
    return off;
  }, []);
  return state;
}

/**
 * Wraps the stack navigator. Off (every phone layout): one flex child, so the navigator renders
 * exactly as before. On: rail + Chats column + the navigator as the centre pane + side panels.
 * The tree shape is the same either way, so crossing the threshold never remounts the navigator.
 */
export function DeskShell({ children }: { children: ReactNode }) {
  const window = useWindowDimensions();
  const [rootWidth, setRootWidth] = useState<number | null>(null);
  const [center, setCenter] = useState<{ width: number; height: number } | null>(null);
  const dex = useDexState();
  const choice = deskPrefs.use(s => s.choice);
  const loaded = deskPrefs.use(s => s.loaded);
  const paired = store.use(s => s.settings !== null);
  useEffect(() => { void loadDeskPrefs(); }, []);
  const width = rootWidth ?? window.width;
  const decision = deskDecision({ choice, urlChoice: URL_DESK_CHOICE, width, dex, pointer: Platform.OS !== "web" && dex.pointer === true });
  const on = decision.on && paired && loaded;
  useEffect(() => { deskState.set({ on, reason: decision.reason, width }); }, [on, decision.reason, width]);
  const onRoot = useCallback((e: LayoutChangeEvent) => setRootWidth(e.nativeEvent.layout.width), []);
  const onCenter = useCallback((e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setCenter(prev => prev && prev.width === w && prev.height === h ? prev : { width: w, height: h });
  }, []);
  const [quick, setQuick] = useState(false);
  return <View style={styles.root} onLayout={onRoot} testID={on ? "desk-shell" : undefined}>
    {on ? <DeskRail onQuick={() => setQuick(true)} /> : null}
    {on ? <DeskChatsColumn /> : null}
    <View style={styles.center} onLayout={onCenter} testID={on ? "desk-center" : undefined}>
      <PaneSizeProvider size={on && center ? center : null}>{children}</PaneSizeProvider>
    </View>
    {on ? <DeskSideColumn /> : null}
    {on ? <DeskKeys onQuick={() => setQuick(open => !open)} onEscape={() => setQuick(false)} /> : null}
    {on && quick ? <QuickSwitch onClose={() => setQuick(false)} /> : null}
  </View>;
}

/** Go to a panel: centre panels navigate, side panels scroll into view and flash. */
function useOpenPanel() {
  const navigation = useNavigation<Nav>();
  return useCallback((id: DeskPanelId) => {
    focusDeskPanel(id);
    if (id === "orchestra") navigation.navigate("Main");
    else if (id === "chat" && store.get().activeId) navigation.navigate("Chat");
  }, [navigation]);
}

function DeskRail({ onQuick }: { onQuick(): void }) {
  const navigation = useNavigation<Nav>();
  const open = useOpenPanel();
  const selected = deskFocus.use(s => s.id) ?? "orchestra";
  const pending = approvals.use(s => s.items.filter(actionable).length);
  return <View style={styles.rail} testID="desk-rail">
    <View accessibilityRole="tablist" style={styles.railTabs}>
      {DESK_PANELS.map((panel, i) => <RailButton key={panel.id} role="tab" selected={selected === panel.id}
        label={panel.label} hint={`Ctrl+${i + 1}`} icon={RAIL_ICON[panel.id]} badge={panel.id === "needs" && pending ? String(pending) : undefined}
        onPress={() => open(panel.id)} />)}
    </View>
    <View style={styles.railFoot}>
      <RailButton role="button" label="Quick switch" hint="Ctrl+K" icon="⌘" onPress={onQuick} />
      <RailButton role="button" label="Settings" icon="⚙" onPress={() => navigation.navigate("Settings")} />
    </View>
  </View>;
}

function RailButton({ role, selected = false, label, hint, icon, badge, onPress }: { role: "tab" | "button"; selected?: boolean; label: string; hint?: string; icon: string; badge?: string; onPress(): void }) {
  const [hover, setHover] = useState(false);
  const dom = useDomElement(element => { if (hint) element.title = `${label} (${hint})`; });
  return <Pressable ref={dom} accessibilityRole={role} accessibilityLabel={label} accessibilityHint={hint} accessibilityState={role === "tab" ? { selected } : undefined} aria-selected={role === "tab" ? selected : undefined}
    onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
    style={[styles.railButton, hover && styles.railHover, selected && styles.railSelected]}>
    <Text style={[styles.railIcon, selected && styles.railIconOn]}>{icon}</Text>
    <Text style={[styles.railLabel, selected && styles.railIconOn]} numberOfLines={1}>{label.split(" ")[0]}</Text>
    {badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View> : null}
  </Pressable>;
}

function DeskChatsColumn() {
  const navigation = useNavigation<Nav>();
  const width = deskPrefs.use(s => s.leftWidth);
  const collapsed = deskPrefs.use(s => s.collapsed.chats === true);
  const lit = useFocusFlash("chats");
  if (collapsed) return <Pressable accessibilityRole="button" accessibilityLabel="Expand Chats" onPress={() => setPanelCollapsed("chats", false)} style={styles.collapsedColumn} testID="desk-chats-collapsed">
    <Text style={styles.collapsedText}>Chats ▸</Text>
  </Pressable>;
  return <>
    <View testID="desk-panel-chats" style={[styles.chats, { width }, lit && styles.lit]}>
      <View style={styles.chatsHeader}>
        <Pressable accessibilityRole="button" accessibilityLabel="Collapse Chats" accessibilityState={{ expanded: true }} onPress={() => setPanelCollapsed("chats", true)} style={styles.collapse}>
          <Text style={styles.chevron}>◂</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.columnTitle}>Chats</Text>
        <WorkspaceActions navigation={navigation} />
      </View>
      <ChatsPane navigation={navigation} focused />
    </View>
    <DeskSplitter label="Chats column width" width={width} direction={1}
      onWidth={next => updateDeskPrefs(() => ({ leftWidth: clampWidth(LEFT_WIDTH, next) }))}
      onNudge={delta => updateDeskPrefs(s => ({ leftWidth: clampWidth(LEFT_WIDTH, s.leftWidth + delta) }))} />
  </>;
}

function DeskSideColumn() {
  const width = deskPrefs.use(s => s.rightWidth);
  const scroll = useRef<ScrollView>(null);
  const offsets = useRef(new Map<DeskPanelId, number>());
  const onPanelLayout = useCallback((id: DeskPanelId, y: number) => { offsets.current.set(id, y); }, []);
  const focus = deskFocus.use(s => s);
  useEffect(() => {
    if (!focus.id || !SIDE.includes(focus.id)) return;
    const id = focus.id;
    // After an expand the layout settles a frame later.
    const frame = requestAnimationFrame(() => scroll.current?.scrollTo({ y: Math.max(0, (offsets.current.get(id) ?? 0) - 4), animated: true }));
    return () => cancelAnimationFrame(frame);
  }, [focus]);
  return <>
    <DeskSplitter label="Side panels width" width={width} direction={-1}
      onWidth={next => updateDeskPrefs(() => ({ rightWidth: clampWidth(RIGHT_WIDTH, next) }))}
      onNudge={delta => updateDeskPrefs(s => ({ rightWidth: clampWidth(RIGHT_WIDTH, s.rightWidth + delta) }))} />
    <View testID="desk-side" style={[styles.side, { width }]}>
      <ScrollView ref={scroll} contentContainerStyle={styles.sideContent}>
        <DeskNeedsPanel onLayout={onPanelLayout} />
        <DeskHostsPanel onLayout={onPanelLayout} />
        <DeskPhoneQueuePanel onLayout={onPanelLayout} />
        <DeskWorkersPanel onLayout={onPanelLayout} />
        <DeskTracesPanel onLayout={onPanelLayout} />
        <DeskBuildPanel onLayout={onPanelLayout} />
      </ScrollView>
    </View>
  </>;
}

/** Web keyboard: Ctrl/⌘+K quick switch, Ctrl/⌘+1..9 panels, Escape closes. Native has no global key hook yet. */
function DeskKeys({ onQuick, onEscape }: { onQuick(): void; onEscape(): void }) {
  const open = useOpenPanel();
  const handlers = useRef({ onQuick, onEscape, open });
  handlers.current = { onQuick, onEscape, open };
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") { handlers.current.onEscape(); return; }
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() === "k") { event.preventDefault(); handlers.current.onQuick(); return; }
      const n = Number(event.key);
      const panel = Number.isInteger(n) && n >= 1 ? DESK_PANELS[n - 1] : undefined;
      if (panel) { event.preventDefault(); handlers.current.open(panel.id); }
    };
    document.addEventListener("keydown", listener, { capture: true });
    return () => document.removeEventListener("keydown", listener, { capture: true });
  }, []);
  return null;
}

type QuickItem = { key: string; label: string; detail: string; run(): void };

function QuickSwitch({ onClose }: { onClose(): void }) {
  const navigation = useNavigation<Nav>();
  const open = useOpenPanel();
  const conversations = store.use(s => s.conversations);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const items = useMemo((): QuickItem[] => {
    const chats = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).map((c): QuickItem => ({
      key: `chat:${c.id}`, label: c.title || "Untitled chat", detail: `Chat · ${c.harness}`,
      run: () => { setActive(c.id); navigation.navigate("Chat"); },
    }));
    const panels = DESK_PANELS.map((p, i): QuickItem => ({ key: `panel:${p.id}`, label: p.label, detail: `Panel · Ctrl+${i + 1}`, run: () => open(p.id) }));
    const screens: QuickItem[] = [
      { key: "screen:settings", label: "Settings", detail: "Screen", run: () => navigation.navigate("Settings") },
      { key: "screen:approvals", label: "Approvals", detail: "Screen", run: () => navigation.navigate("Approvals") },
      { key: "screen:trace", label: "Agent trace", detail: "Screen", run: () => navigation.navigate("Trace") },
      { key: "screen:roadmap", label: "Roadmap", detail: "Screen", run: () => navigation.navigate("Roadmap") },
    ];
    const q = query.trim().toLowerCase();
    const all = [...chats, ...panels, ...screens];
    return (q ? all.filter(item => item.label.toLowerCase().includes(q) || item.detail.toLowerCase().includes(q)) : all).slice(0, 12);
  }, [conversations, navigation, open, query]);
  const choose = (item: QuickItem | undefined) => { if (!item) return; onClose(); item.run(); };
  return <View style={styles.quickBackdrop} testID="quick-switch">
    <Pressable accessibilityLabel="Close quick switch" style={StyleSheet.absoluteFill} onPress={onClose} />
    <View style={styles.quick}>
      <TextInput autoFocus value={query} onChangeText={next => { setQuery(next); setIndex(0); }} placeholder="Jump to a chat, panel or screen" placeholderTextColor={colors.textTertiary}
        accessibilityLabel="Quick switch" style={styles.quickInput}
        onKeyPress={event => {
          const key = event.nativeEvent.key;
          if (key === "ArrowDown") setIndex(i => Math.min(items.length - 1, i + 1));
          else if (key === "ArrowUp") setIndex(i => Math.max(0, i - 1));
          else if (key === "Enter") choose(items[index]);
          else if (key === "Escape") onClose();
        }} />
      {items.length === 0 ? <Text style={styles.quickEmpty}>No matches</Text> : null}
      {items.map((item, i) => <Pressable key={item.key} testID="quick-switch-item" accessibilityRole="button" accessibilityLabel={`${item.label}, ${item.detail}`} accessibilityState={{ selected: i === index }}
        onPress={() => choose(item)} onHoverIn={() => setIndex(i)} style={[styles.quickRow, i === index && styles.quickRowOn]}>
        <Text style={styles.quickLabel} numberOfLines={1}>{item.label}</Text>
        <Text style={styles.quickDetail} numberOfLines={1}>{item.detail}</Text>
      </Pressable>)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", backgroundColor: colors.bg },
  center: { flex: 1, minWidth: 0 },
  rail: { width: 68, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border, paddingVertical: space.sm, justifyContent: "space-between" },
  railTabs: { gap: 2 },
  railFoot: { gap: 2 },
  railButton: { alignItems: "center", justifyContent: "center", minHeight: 48, marginHorizontal: 6, borderRadius: radius.sm, paddingVertical: 4 },
  railHover: { backgroundColor: "rgba(236,232,223,.06)" },
  railSelected: { backgroundColor: "rgba(215,185,134,.10)" },
  railIcon: { fontSize: 17, lineHeight: 20, color: colors.textMuted },
  railIconOn: { color: colors.gold },
  railLabel: { fontFamily: fonts.semibold, fontSize: 9, letterSpacing: .3, color: colors.textTertiary, marginTop: 2 },
  badge: { position: "absolute", top: 2, right: 6, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  badgeText: { fontFamily: fonts.semibold, fontSize: 10, color: colors.bg },
  chats: { borderLeftWidth: 2, borderLeftColor: "transparent" },
  lit: { borderLeftColor: colors.gold },
  chatsHeader: { flexDirection: "row", alignItems: "center", minHeight: 52, paddingRight: 4 },
  collapse: { width: 32, minHeight: 44, alignItems: "center", justifyContent: "center" },
  chevron: { color: colors.textTertiary, fontSize: 14 },
  columnTitle: { ...type.section, color: colors.text, flex: 1 },
  collapsedColumn: { width: 28, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border, alignItems: "center", paddingTop: space.lg },
  collapsedText: { ...type.label, color: colors.textMuted, transform: [{ rotate: "90deg" }], width: 80, textAlign: "center", marginTop: 40 },
  side: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  sideContent: { paddingBottom: space.xxl },
  quickBackdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,.55)", alignItems: "center", paddingTop: "12%" },
  quick: { width: 560, maxWidth: "90%", backgroundColor: colors.surfaceRaised, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.sm, gap: 2 },
  quickInput: { ...type.body, color: colors.text, minHeight: 44, paddingHorizontal: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, marginBottom: space.xs },
  quickEmpty: { ...type.small, color: colors.textTertiary, padding: space.md },
  quickRow: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.sm },
  quickRowOn: { backgroundColor: "rgba(215,185,134,.10)" },
  quickLabel: { ...type.small, color: colors.text, flex: 1 },
  quickDetail: { ...type.mono, fontSize: 11, color: colors.textTertiary },
});
