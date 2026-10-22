import { StackActions } from "@react-navigation/native";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { AppState, Keyboard, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Ellipse, Path, Rect as SvgRect, Text as SvgText } from "react-native-svg";
import { primitiveRect, type Primitive, type Rect, type SurfaceRoute } from "../../../shared/agent-surface";
import { debugNavigationRef as nav } from "../debug/nav";
import { annotate, enterAnnotation } from "../store/annotate";
import { store } from "../store/app";
import { colors } from "../theme";
import { DEFAULT_MAIN_TAB } from "../lib/home";
import { allowSurface, clearSurface, markSurfaceCommitted, publishSurface, setSurfaceActions, snapshot, surface, surfaceClient, updateSurface, surfaceIsCommitted, surfaceMainTab } from "./state";

/** Explicit semantic rect registration, measured in app viewport coordinates. */
const measures = new Map<string, () => void>();
export function SurfaceAnchor({ name, children }: { name: string; children: ReactNode }) {
  const ref = useRef<View>(null);
  useEffect(() => {
    const measure = () => ref.current?.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0) return;
      const current = surface.get();
      // Hidden native-stack screens must not publish anchors for the foreground.
      if (name.startsWith("chat.") && current.route !== "chat") return;
      updateSurface({ anchors: { ...current.anchors, [name]: { x, y, width, height } } });
    });
    measures.set(name, measure); measure();
    return () => { measures.delete(name); const anchors = { ...surface.get().anchors }; delete anchors[name]; updateSurface({ anchors }); };
  }, [name]);
  return <View ref={ref} collapsable={false} onLayout={() => measures.get(name)?.()}>{children}</View>;
}
function currentRoute(): string {
  const r = nav.getCurrentRoute();
  if (r?.name === "Main") {
    const p = r.params;
    const tab = surfaceMainTab(r.key) ?? (p && "tab" in p ? p.tab : DEFAULT_MAIN_TAB);
    return tab === 0 ? "bots" : tab === 2 ? "orchestra" : "chats";
  }
  return r?.name.toLowerCase() ?? "unready";
}
function navigate(destination: SurfaceRoute): void {
  if (!nav.isReady()) throw new Error("Navigation unavailable");
  const routes = nav.getRootState()?.routes ?? [];
  // Never replace/reset/unmount the attached Chat: its unsent composer stays mounted.
  if (destination === "chat") {
    if (!routes.some(r => r.name === "Chat")) throw new Error("Attached chat no longer mounted");
    nav.dispatch(StackActions.popTo("Chat"));
  } else if (destination === "back") {
    if (!nav.canGoBack() || routes.at(-1)?.name === "Chat") throw new Error("Cannot leave attached chat");
    nav.goBack();
  } else if (destination === "bots" || destination === "chats" || destination === "orchestra") {
    if (routes.length >= 12) throw new Error("Navigation depth limit");
    nav.dispatch(StackActions.push("Main", { tab: destination === "bots" ? 0 : destination === "orchestra" ? 2 : 1 }));
  } else {
    const name = destination === "trace" ? "Trace" : destination === "lab" ? "Lab" : "Settings";
    if (routes.length >= 12) throw new Error("Navigation depth limit");
    nav.dispatch(StackActions.push(name));
  }
}
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
export function AgentSurface() {
  const dimensions = useWindowDimensions(), safe = useSafeAreaInsets();
  const s = surface.use(v => v);
  useLayoutEffect(() => { markSurfaceCommitted(s); }, [s]);
  const annotationOpen = annotate.use(v => v.active);
  useEffect(() => {
    updateSurface({ annotationOpen });
  }, [annotationOpen]);
  useEffect(() => {
    updateSurface({ viewport: { x: 0, y: 0, width: dimensions.width, height: dimensions.height }, insets: { ...surface.get().insets, ...safe } });
    for (const measure of measures.values()) measure();
  }, [dimensions.width, dimensions.height, safe.top, safe.bottom, safe.left, safe.right]);
  useEffect(() => {
    const updateRoute = () => {
      const route = currentRoute();
      if (route !== surface.get().route) updateSurface({ route, anchors: {} });
      for (const measure of measures.values()) measure();
    };
    const attach = () => {
      const state = store.get(), chat = state.conversations.find(c => c.id === state.activeId);
      // Attachment follows the existing active chat only; never creates or selects one.
      const host = chat?.targetHostId ?? state.connection.host;
      const target = host && chat?.sessionId && chat.profileId ? { client: surfaceClient, host, profile: chat.profileId, session: chat.sessionId, chat: chat.id } : undefined;
      if (JSON.stringify(surface.get().target) !== JSON.stringify(target)) updateSurface({ target });
    };
    attach(); updateRoute();
    const unstore = store.subscribe(attach), unnav = nav.addListener("state", updateRoute);
    const show = Keyboard.addListener("keyboardDidShow", e => updateSurface({ insets: { ...surface.get().insets, keyboard: Math.max(0, dimensions.height - e.endCoordinates.screenY) } }));
    const hide = Keyboard.addListener("keyboardDidHide", () => updateSurface({ insets: { ...surface.get().insets, keyboard: 0 } }));
    const app = AppState.addEventListener("change", state => { if (state !== "active") allowSurface(false); });
    const heartbeat = setInterval(publishSurface, 4000);
    setSurfaceActions({ navigate, openAnnotation: enterAnnotation, rendered: async () => { await frame(); updateRoute(); await frame(); await frame(); if (!surfaceIsCommitted()) throw new Error("Overlay not committed"); } });
    return () => { unstore(); unnav(); show.remove(); hide.remove(); app.remove(); clearInterval(heartbeat); setSurfaceActions(undefined); };
  }, [dimensions.height]);
  const snap = snapshot();
  const usable: Rect = { x: s.insets.left, y: s.insets.top, width: s.viewport.width - s.insets.left - s.insets.right, height: Math.max(0, s.viewport.height - s.insets.top - Math.max(s.insets.bottom, s.insets.keyboard)) };
  return <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
    <View pointerEvents="none" testID="agent-guide-overlay" style={[styles.clip, { left: usable.x, top: usable.y, width: usable.width, height: usable.height }]}>
      {snap && s.drawUntil > Date.now() ? <Svg width={usable.width} height={usable.height} viewBox={`${usable.x} ${usable.y} ${usable.width} ${usable.height}`}>
        {s.drawings.map((p, index) => <GuidePrimitive key={index} primitive={p} rect={primitiveRect(p, snap)} />)}
      </Svg> : null}
    </View>
    {s.enabled ? <View pointerEvents="box-none" style={[styles.controls, { top: s.insets.top, right: s.insets.right + 8 }]}>
      <SurfaceAnchor name="guide.dismiss"><Pressable accessibilityRole="button" accessibilityLabel="Dismiss agent guide" onPress={clearSurface} style={styles.button}><Text style={styles.label}>Dismiss guide</Text></Pressable></SurfaceAnchor>
      <SurfaceAnchor name="guide.disable"><Pressable accessibilityRole="button" accessibilityLabel="Disable agent control" onPress={() => allowSurface(false)} style={styles.button}><Text style={styles.label}>Control off</Text></Pressable></SurfaceAnchor>
    </View> : null}
  </View>;
}
function GuidePrimitive({ primitive: p, rect: r }: { primitive: Primitive; rect?: Rect }) {
  if (!r) return null;
  const x = r.x + 2, y = r.y + 2, w = Math.max(1, r.width - 4), h = Math.max(1, r.height - 4), stroke = "#f2cf81";
  return <>
    {p.kind === "circle" ? <Ellipse cx={x+w/2} cy={y+h/2} rx={w/2} ry={h/2} fill="none" stroke={stroke} strokeWidth={3} /> : null}
    {p.kind === "box" ? <SvgRect x={x} y={y} width={w} height={h} rx={5} fill="#f2cf8118" stroke={stroke} strokeWidth={3} /> : null}
    {p.kind === "arrow" ? <Path d={`M ${x} ${y+h} L ${x+w} ${y} M ${x+w-12} ${y+2} L ${x+w} ${y} L ${x+w-2} ${y+12}`} fill="none" stroke={stroke} strokeWidth={3} /> : null}
    {p.text || p.kind === "label" ? <SvgText x={x+4} y={Math.min(y+h-3,y+17)} fill={stroke} fontSize={14} fontWeight="600">{p.text ?? "Here"}</SvgText> : null}
  </>;
}
export function ChatGuideControls() {
  const enabled = surface.use(s => s.enabled), target = surface.use(s => s.target);
  return <View style={styles.row}>
    <SurfaceAnchor name="chat.annotate"><Pressable accessibilityRole="button" accessibilityLabel="Annotate this screen" onPress={enterAnnotation} style={styles.button}><Text style={styles.label}>✎ Annotate</Text></Pressable></SurfaceAnchor>
    <SurfaceAnchor name="chat.guide"><Pressable accessibilityRole="switch" accessibilityLabel="Allow agent guide in this chat" accessibilityState={{ checked: enabled, disabled: !target }} disabled={!target} onPress={() => allowSurface(!enabled)} style={styles.button}><Text style={styles.label}>{enabled ? "Guide on" : "Guide"}</Text></Pressable></SurfaceAnchor>
  </View>;
}
const styles = StyleSheet.create({
  clip: { position: "absolute", overflow: "hidden" }, controls: { position: "absolute", flexDirection: "row", gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  button: { minHeight: 44, paddingHorizontal: 8, justifyContent: "center" },
  label: { color: colors.gold, fontSize: 12 },
});
