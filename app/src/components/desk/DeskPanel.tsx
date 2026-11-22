import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { deskFocus, deskPrefs, setPanelCollapsed, type DeskPanelId } from "../../lib/desk";
import { colors, fonts, radius, space, type } from "../../theme";

/** Web only: give a host View a DOM affordance RN style cannot express (cursor, tab stop). */
export function useDomElement(apply: (element: HTMLElement) => (() => void) | void) {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  return useCallback((node: View | null) => {
    const element: unknown = node;
    if (Platform.OS !== "web" || typeof HTMLElement === "undefined" || !(element instanceof HTMLElement)) return;
    return applyRef.current(element) ?? undefined;
  }, []);
}

/** Highlight for a panel the owner just jumped to (rail tab, Ctrl+N, quick switch). */
export function useFocusFlash(id: DeskPanelId): boolean {
  const focus = deskFocus.use(s => s);
  const [lit, setLit] = useState(false);
  useEffect(() => {
    if (focus.id !== id) return;
    setLit(true);
    const timer = setTimeout(() => setLit(false), 1400);
    return () => clearTimeout(timer);
  }, [focus, id]);
  return lit;
}

export function DeskPanel({ id, title, meta, children, onLayout }: {
  id: DeskPanelId;
  title: string;
  meta?: string;
  children: ReactNode;
  onLayout?(id: DeskPanelId, y: number): void;
}) {
  const collapsed = deskPrefs.use(s => s.collapsed[id] === true);
  const lit = useFocusFlash(id);
  const [hover, setHover] = useState(false);
  const layout = useCallback((event: LayoutChangeEvent) => onLayout?.(id, event.nativeEvent.layout.y), [id, onLayout]);
  return <View testID={`desk-panel-${id}`} onLayout={layout} style={[styles.panel, lit && styles.lit]}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${collapsed ? "Expand" : "Collapse"} ${title}`}
      accessibilityState={{ expanded: !collapsed }}
      onPress={() => setPanelCollapsed(id, !collapsed)}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={[styles.header, hover && styles.headerHover]}
    >
      <Text style={styles.chevron}>{collapsed ? "▸" : "▾"}</Text>
      <Text accessibilityRole="header" style={styles.title} numberOfLines={1}>{title}</Text>
      {meta ? <Text style={styles.meta} numberOfLines={1}>{meta}</Text> : null}
    </Pressable>
    {collapsed ? null : <View testID={`desk-panel-body-${id}`} style={styles.body}>{children}</View>}
  </View>;
}

/** A column edge the owner drags (mouse, trackpad or touch) to resize the neighbouring column. */
export function DeskSplitter({ label, width, direction, onWidth, onNudge }: {
  label: string;
  width: number;
  /** +1: dragging right grows the column (left column); -1: dragging left grows it (right column). */
  direction: 1 | -1;
  onWidth(next: number): void;
  onNudge(delta: number): void;
}) {
  const start = useRef(width);
  const latest = useRef(width);
  latest.current = width;
  const [active, setActive] = useState(false);
  const pan = Gesture.Pan().runOnJS(true).minDistance(1)
    .onBegin(() => { start.current = latest.current; setActive(true); })
    .onUpdate(event => onWidth(start.current + direction * event.translationX))
    .onFinalize(() => setActive(false));
  const dom = useDomElement(element => { element.style.cursor = "col-resize"; element.style.touchAction = "none"; });
  return <GestureDetector gesture={pan}>
    <View
      ref={dom}
      testID={`desk-splitter-${direction === 1 ? "left" : "right"}`}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ now: Math.round(width), text: `${Math.round(width)} pixels` }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={event => onNudge(event.nativeEvent.actionName === "increment" ? 24 : -24)}
      style={styles.splitter}
    >
      <View style={[styles.splitterLine, active && styles.splitterActive]} />
    </View>
  </GestureDetector>;
}

export const deskStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 32, paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.sm },
  rowHover: { backgroundColor: "rgba(236,232,223,.05)" },
  name: { ...type.small, color: colors.text, flexShrink: 1 },
  muted: { ...type.small, color: colors.textMuted, flexShrink: 1 },
  mono: { ...type.mono, fontSize: 11, color: colors.textMuted, flexShrink: 1 },
  faint: { ...type.mono, fontSize: 11, color: colors.textTertiary },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pill: { ...type.mono, fontSize: 10, color: colors.textTertiary, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
  empty: { ...type.small, color: colors.textTertiary, paddingHorizontal: space.md, paddingVertical: space.sm },
  alert: { ...type.small, color: colors.warn, paddingHorizontal: space.md, paddingVertical: space.xs },
  action: { ...type.label, color: colors.gold },
});

const styles = StyleSheet.create({
  panel: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingBottom: space.sm, borderLeftWidth: 2, borderLeftColor: "transparent" },
  lit: { borderLeftColor: colors.gold },
  header: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 40, paddingHorizontal: space.md },
  headerHover: { backgroundColor: "rgba(236,232,223,.04)" },
  chevron: { color: colors.textTertiary, fontSize: 12, width: 12 },
  title: { fontFamily: fonts.semibold, fontSize: 13, letterSpacing: .4, color: colors.text, textTransform: "uppercase", flex: 1 },
  meta: { ...type.mono, fontSize: 11, color: colors.textTertiary },
  body: { gap: 2 },
  splitter: { width: 9, alignSelf: "stretch", alignItems: "center", justifyContent: "center" },
  splitterLine: { width: StyleSheet.hairlineWidth, alignSelf: "stretch", backgroundColor: colors.border },
  splitterActive: { width: 2, backgroundColor: colors.gold },
});
