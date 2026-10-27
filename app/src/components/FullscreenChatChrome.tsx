import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Svg, { Path } from "react-native-svg";
import { haptic } from "../haptics";
import {
  fullscreenCloseBounds,
  fullscreenCloseLabel,
  fullscreenPillLabel,
  fullscreenPillState,
  type FullscreenCloseSide,
} from "../lib/a11y-fullscreen-chat-chrome";
import { CLOSE_GLYPH, PILL_HIT, type PillGeometry, type PillGlyph } from "../lib/chat-window";
import type { OrbState } from "../lib/orb-phase";
import { colors, glass, type } from "../theme";
import { AgentOrb } from "./AgentOrb";

export interface FullscreenChatChromeProps {
  geometry: PillGeometry;
  title: string;
  status: string[];
  primary: { glyph: PillGlyph; text: string } | null;
  onClose(): void;
  onTogglePill(): void;
  pillOpen: boolean;
  closeSide: FullscreenCloseSide;
}

/**
 * Minimal full-screen chrome. Geometry is supplied by ChatScreen's existing native
 * cutout reader; this component never reads or guesses hardware cutout coordinates.
 * The close X shifts below an edge-to-edge cutout pill instead of overlapping it.
 */
export function FullscreenChatChrome({
  geometry, title, status, primary, onClose, onTogglePill, pillOpen, closeSide,
}: FullscreenChatChromeProps) {
  const { width: windowWidth } = useWindowDimensions();
  const close = fullscreenCloseBounds(geometry, windowWidth, closeSide);
  const hole = geometry.hole;
  const r = geometry.height / 2;
  const hitPad = Math.max(0, (PILL_HIT - geometry.height) / 2);
  const phase: OrbState["phase"] = primary?.glyph === "tool"
    ? "tool"
    : primary?.glyph === "activity" ? "thinking" : "idle";

  // The very same even-odd cutout outline and reserved status slot as WindowPill.
  // With no hardware cutout the pill becomes an ordinary safe-area glass capsule.
  const outline = `M${r} 0H${geometry.width - r}A${r} ${r} 0 0 1 ${geometry.width - r} ${geometry.height}H${r}A${r} ${r} 0 0 1 ${r} 0Z`;
  const lens = hole
    ? `M${hole.left} ${r}a${hole.width / 2} ${hole.width / 2} 0 1 0 ${hole.width} 0a${hole.width / 2} ${hole.width / 2} 0 1 0 ${-hole.width} 0Z`
    : "";
  const name = title.trim() || "Chat";
  const leading = <>
    <AgentOrb size={14} thinking={{ phase }} label={name} animated={false} />
    <Text testID="chat-fullscreen-pill-title" style={styles.pillTitle} numberOfLines={1} maxFontSizeMultiplier={1.15}>{name}</Text>
  </>;
  const trailing = primary ? <View testID="chat-fullscreen-pill-status" style={styles.statusSlot}>
    <Feather name={primary.glyph} size={11} color={primary.glyph === "wifi-off" ? colors.danger : colors.gold} />
    <Text style={styles.statusText} numberOfLines={1} maxFontSizeMultiplier={1.1}>{primary.text}</Text>
  </View> : null;

  return <View testID="chat-fullscreen-chrome" pointerEvents="box-none" style={StyleSheet.absoluteFill}>
    <Pressable
      testID="chat-fullscreen-pill"
      accessible
      accessibilityRole="button"
      accessibilityLabel={fullscreenPillLabel(title, status)}
      accessibilityState={fullscreenPillState(pillOpen)}
      onPress={() => { haptic.select(); onTogglePill(); }}
      hitSlop={{ top: hitPad, bottom: hitPad }}
      style={[
        styles.pill,
        hole && styles.pillCutout,
        { left: geometry.left, top: geometry.top, width: geometry.width, height: geometry.height, borderRadius: r },
      ]}
    >
      {hole ? <>
        <Svg testID="chat-fullscreen-pill-shape" width={geometry.width} height={geometry.height} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Path d={outline + lens} fill={glass.fillRaised} fillRule="evenodd" stroke={glass.hair2} strokeWidth={StyleSheet.hairlineWidth} />
        </Svg>
        <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.pillSide, { width: Math.max(0, hole.left - 16), flexShrink: 0 }]}>{leading}</View>
        <View testID="chat-fullscreen-pill-hole" pointerEvents="none" style={{ width: hole.width }} />
        <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.pillSide, styles.pillSideEnd]}>{trailing}</View>
      </> : <>
        <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.pillSide}>{leading}</View>
        <View accessible={false} importantForAccessibility="no-hide-descendants">{trailing}</View>
      </>}
    </Pressable>

    <Pressable
      testID="chat-fullscreen-close"
      accessible
      accessibilityRole="button"
      accessibilityLabel={fullscreenCloseLabel()}
      onPress={() => { haptic.tap(); onClose(); }}
      style={[styles.closeHit, close]}
    >
      <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.closeGlyph}>
        <Feather name="x" size={14} color={colors.textMuted} />
      </View>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  pill: {
    position: "absolute",
    zIndex: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    backgroundColor: glass.fillRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hair2,
  },
  pillCutout: { backgroundColor: "transparent", borderWidth: 0 },
  pillSide: { flexDirection: "row", alignItems: "center", gap: 6, overflow: "hidden", flexShrink: 1, minWidth: 0 },
  pillSideEnd: { flex: 1, justifyContent: "flex-end" },
  pillTitle: { ...type.label, color: colors.text, flexShrink: 1, minWidth: 0, letterSpacing: 0 },
  statusSlot: { flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 0, marginLeft: "auto" },
  statusText: { ...type.mono, fontSize: 10, lineHeight: 13, color: colors.text, flexShrink: 0 },
  closeHit: { position: "absolute", zIndex: 31, alignItems: "center", justifyContent: "center" },
  closeGlyph: {
    width: CLOSE_GLYPH,
    height: CLOSE_GLYPH,
    borderRadius: CLOSE_GLYPH / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.quiet,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hair2,
  },
});
