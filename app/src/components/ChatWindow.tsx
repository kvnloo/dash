import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { PixelRatio, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { haptic } from "../haptics";
import {
  CLOSE_GLYPH,
  CLOSE_HIT,
  PILL_HIT,
  identityLabel,
  identityLines,
  morphFrom,
  type IdentityInput,
  type PillGeometry,
  type WindowOrigin,
} from "../lib/chat-window";
import type { OrbState } from "../lib/orb-phase";
import type { TreeNode } from "../lib/tree";
import { useHandedness } from "../lib/useHandedness";
import { fade, snappy } from "../motion";
import { colors, glass, radius, space, type } from "../theme";
import { AgentOrb } from "./AgentOrb";
import { Tree } from "./Tree";

/**
 * Open/close morph for the chat window. The window is laid out at its final size on the first
 * frame; only transform and opacity run, on the UI thread, from the source row.
 */
export function useWindowMorph(origin: WindowOrigin | undefined, enabled: boolean) {
  const { height } = useWindowDimensions();
  const from = useMemo(() => morphFrom(origin, height), [origin, height]);
  const progress = useSharedValue(enabled ? 0 : 1);
  const [settling, setSettling] = useState(enabled);
  useEffect(() => {
    if (!enabled) return;
    progress.value = withTiming(1, { ...snappy, reduceMotion: ReduceMotion.System }, done => { if (done) runOnJS(setSettling)(false); });
  }, [enabled, progress]);
  const style = useAnimatedStyle(() => enabled ? {
    opacity: progress.value,
    transform: [
      { translateY: from.translateY * (1 - progress.value) },
      { scale: from.scale + (1 - from.scale) * progress.value },
    ],
  } : {});
  const close = useCallback((done: () => void) => {
    if (!enabled) { done(); return; }
    setSettling(true);
    progress.value = withTiming(0, { ...fade, reduceMotion: ReduceMotion.System }, () => { runOnJS(done)(); });
  }, [enabled, progress]);
  return { style, close, settling };
}

/** The app-wide nav collapsed into a slim status pill around (or below) the camera cut-out. */
export function WindowPill({ geometry, title, thinking, status, open, onToggle }: {
  geometry: PillGeometry;
  title: string;
  thinking: OrbState;
  status: string[];
  open: boolean;
  onToggle(): void;
}) {
  const statusText = status.join(" · ");
  const label = `Navigation, collapsed. ${title}${statusText ? `, ${statusText}` : ""}. Double-tap to ${open ? "hide" : "show"} navigation.`;
  const hitPad = Math.max(0, (PILL_HIT - geometry.height) / 2);
  const left = <><AgentOrb size={14} thinking={thinking} label={`${title} ${thinking.phase}`} />
    <Text style={styles.pillTitle} numberOfLines={1}>{title}</Text></>;
  const right = statusText ? <Text style={styles.pillStatus} numberOfLines={1}>{statusText}</Text> : null;
  return <Pressable
    testID="chat-window-pill"
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ expanded: open }}
    onPress={() => { haptic.select(); onToggle(); }}
    hitSlop={{ top: hitPad, bottom: hitPad }}
    style={[styles.pill, { left: geometry.left, top: geometry.top, width: geometry.width, height: geometry.height, borderRadius: geometry.height / 2 }]}
  >
    {geometry.hole ? <>
      <View style={[styles.pillSide, { width: geometry.hole.left }]}>{left}</View>
      {/* Hardware pixels: nothing is drawn over the camera hole. */}
      <View style={{ width: geometry.hole.width }} />
      <View style={[styles.pillSide, styles.pillSideEnd]}>{right}</View>
    </> : <>{left}{right}</>}
  </Pressable>;
}

function treeNodes(identity: IdentityInput, title: string): TreeNode[] {
  const session: TreeNode = {
    id: "window-session", kind: "session", label: title,
    detail: identity.sessionId ? `session ${identity.sessionId}` : "session not attached yet",
    meta: "✓ Current",
  };
  const harness: TreeNode = { id: "window-harness", kind: "harness", label: identity.harnessName, meta: identity.model ?? "model unknown", children: [session] };
  const profile: TreeNode = { id: "window-profile", kind: "bot", label: identity.profile ?? "no profile", children: [harness] };
  return [{ id: "window-host", kind: "host", label: identity.hostName ?? "host unknown", children: [profile] }];
}

const TREE_EXPANDED = ["window-host", "window-profile", "window-harness"];
const BADGE_FONT = 11;
/** Options trigger: sliders glyph + surface word, ≥ 44 hit. */
const OPTIONS_RESERVE = 84;

/**
 * The composer grown into the window's attached rectangle: badge row + identity Tree + whatever
 * the screen already docks (workers, queue, composer). One surface; nothing is repeated up top.
 */
export function WindowDock({ identity, title, options, treeOpen, onTree, onClose, notice, children }: {
  identity: IdentityInput;
  title: string;
  options: ReactNode;
  treeOpen: boolean;
  onTree(open: boolean): void;
  onClose(): void;
  notice?: ReactNode;
  children: ReactNode;
}) {
  const thumb = useHandedness();
  const { width } = useWindowDimensions();
  // Monospace advance ≈ 0.6em; the system font scale grows it. Reserve the Options trigger, the X,
  // the chevron and paddings. Text also ellipsizes as a backstop.
  const budget = Math.max(10, Math.floor((width - OPTIONS_RESERVE - CLOSE_HIT - 2 * space.sm - 40) / (BADGE_FONT * 0.6 * PixelRatio.getFontScale())));
  const lines = identityLines(identity, budget);
  const nodes = useMemo(() => treeNodes(identity, title), [identity, title]);
  return <View testID="chat-window-dock">
    {treeOpen ? <View testID="chat-window-identity" style={styles.identity}>
      <Tree nodes={nodes} label="Chat identity" initialExpanded={TREE_EXPANDED} inline />
      <Text style={styles.gap}>Lineage unavailable: host has not reported it</Text>
      <Text style={styles.gap}>Model change unavailable: no exact-session model route in this build</Text>
    </View> : null}
    <View testID="chat-window-badge-row" style={[styles.badgeRow, thumb.row]}>
      {options}
      <Pressable
        testID="chat-window-badge"
        accessibilityRole="button"
        accessibilityLabel={identityLabel(identity)}
        accessibilityState={{ expanded: treeOpen }}
        onPress={() => { haptic.select(); onTree(!treeOpen); }}
        style={styles.badge}
      >
        <View style={styles.badgeLines}>
          <Text style={styles.badgeWho} numberOfLines={1} ellipsizeMode="middle">{lines.who}</Text>
          <Text style={[styles.badgeModel, !identity.model && styles.badgeUnknown]} numberOfLines={1} ellipsizeMode="middle">{lines.model}</Text>
        </View>
        <Feather name={treeOpen ? "chevron-down" : "chevron-up"} size={14} color={colors.textTertiary} />
      </Pressable>
      <Pressable testID="chat-window-close" accessibilityRole="button" accessibilityLabel="Close chat window" onPress={() => { haptic.tap(); onClose(); }} style={styles.close}>
        <View style={styles.closeGlyph}><Feather name="x" size={14} color={colors.textMuted} /></View>
      </Pressable>
    </View>
    {notice}
    {children}
  </View>;
}

const styles = StyleSheet.create({
  pill: {
    position: "absolute", zIndex: 30, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10,
    backgroundColor: glass.fillRaised, borderWidth: StyleSheet.hairlineWidth, borderColor: glass.hair2,
  },
  pillSide: { flexDirection: "row", alignItems: "center", gap: 6, overflow: "hidden" },
  pillSideEnd: { flex: 1, justifyContent: "flex-end" },
  pillTitle: { ...type.label, color: colors.text, flexShrink: 1, letterSpacing: 0 },
  pillStatus: { ...type.mono, fontSize: 11, color: colors.textMuted, flexShrink: 1, marginLeft: "auto" },
  identity: { maxHeight: 280, paddingHorizontal: space.md, paddingTop: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: glass.hair },
  gap: { ...type.mono, fontSize: 11, color: colors.textTertiary, paddingVertical: 4, paddingHorizontal: space.sm },
  badgeRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.sm, minHeight: CLOSE_HIT },
  badge: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: space.sm, borderRadius: radius.md },
  badgeLines: { flexShrink: 1, minWidth: 0 },
  badgeWho: { ...type.mono, fontSize: BADGE_FONT, lineHeight: 15, color: colors.textMuted },
  badgeModel: { ...type.mono, fontSize: BADGE_FONT, lineHeight: 15, color: colors.text },
  badgeUnknown: { color: colors.textTertiary },
  close: { width: CLOSE_HIT, height: CLOSE_HIT, alignItems: "center", justifyContent: "center" },
  closeGlyph: { width: CLOSE_GLYPH, height: CLOSE_GLYPH, borderRadius: CLOSE_GLYPH / 2, alignItems: "center", justifyContent: "center", backgroundColor: glass.quiet, borderWidth: StyleSheet.hairlineWidth, borderColor: glass.hair2 },
});
