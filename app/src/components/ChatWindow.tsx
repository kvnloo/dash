import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { PixelRatio, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { ReduceMotion, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { haptic } from "../haptics";
import {
  CLOSE_GLYPH,
  CLOSE_HIT,
  PILL_HIT,
  MODEL_UNKNOWN,
  identityLabel,
  identityLines,
  middleTruncate,
  morphFrame,
  morphFrom,
  pillLensPath,
  sessionIdLabel,
  topCutout,
  type IdentityInput,
  type PillGeometry,
  type PillGlyph,
  type Rect,
  type WindowOrigin,
} from "../lib/chat-window";
import { readCutout } from "../lib/display-cutout";
import { debugUi } from "../debug/ui-store";
import { useHandedness } from "../lib/useHandedness";
import { crossfade, fade, morphDuration, snappy } from "../motion";
import { colors, glass, radius, space, type } from "../theme";
import { AgentOrb } from "./AgentOrb";
import { HostStatsRow } from "./HostStatsRow";

/**
 * Open/close morph for the chat window. The window is laid out at its final size on the first
 * frame; only transform and opacity run, on the UI thread, from the source row.
 */
export function useWindowMorph(origin: WindowOrigin | undefined, enabled: boolean) {
  const { height } = useWindowDimensions();
  const from = useMemo(() => morphFrom(origin, height), [origin, height]);
  const reduced = useReducedMotion();
  const progress = useSharedValue(enabled ? 0 : 1);
  const [settling, setSettling] = useState(enabled);
  useEffect(() => {
    if (!enabled) return;
    // Distance-based: a row far from the centre travels further, so it gets more (bounded) time.
    // Reduce motion: no travel or scale, only the opacity crossfade, which still runs.
    const open = reduced ? crossfade : { ...snappy, duration: morphDuration(from.translateY, height) };
    progress.value = withTiming(1, { ...open, reduceMotion: ReduceMotion.Never }, done => { if (done) runOnJS(setSettling)(false); });
  }, [enabled, progress, reduced, from, height]);
  const style = useAnimatedStyle(() => enabled ? morphFrame(progress.value, from, reduced) : {});
  const close = useCallback((done: () => void) => {
    if (!enabled) { done(); return; }
    setSettling(true);
    progress.value = withTiming(0, { ...fade, reduceMotion: ReduceMotion.Never }, () => { runOnJS(done)(); });
  }, [enabled, progress]);
  return { style, close, settling };
}

/**
 * The app window's camera cut-out, re-read on rotation/resize/inset changes. Debug fixtures can
 * supply a synthetic reading for web proofs; it is labelled as such and never used in release.
 */
export function useDisplayCutout(width: number, height: number, insetTop: number): Rect | null {
  const fixture = debugUi.use(s => s.cutoutFixture ?? null);
  const [reading, setReading] = useState(() => readCutout());
  useEffect(() => {
    // Window insets may not be attached yet, or may still describe the previous rotation.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const refresh = () => {
      const next = readCutout();
      setReading(next);
      if ((!next || Math.abs(next.windowWidth - width) > 2 || Math.abs(next.windowHeight - height) > 2) && ++attempts < 10) {
        timer = setTimeout(refresh, 100);
      }
    };
    refresh();
    return () => clearTimeout(timer);
  }, [width, height, insetTop]);
  return topCutout(fixture ?? reading, { width, height, insetTop });
}

/** The app-wide nav collapsed into a slim status pill around (or below) the camera cut-out. */
export function WindowPill({ geometry, title, status, primary, open, onToggle }: {
  geometry: PillGeometry;
  title: string;
  /** Every observed status, for the accessibility label. */
  status: string[];
  /** The one status with a reserved, unclipped slot. */
  primary: { glyph: PillGlyph; text: string } | null;
  open: boolean;
  onToggle(): void;
}) {
  const statusText = status.join(" · ");
  const label = `Navigation, collapsed. ${title}${statusText ? `, ${statusText}` : ""}. Double-tap to ${open ? "hide" : "show"} navigation.`;
  const hitPad = Math.max(0, (PILL_HIT - geometry.height) / 2);
  // Identity only: the transcript owns the live working indicator.
  const left = <><AgentOrb size={14} thinking={{ phase: "idle" }} label={title} animated={false} />
    <Text testID="chat-window-pill-title" style={styles.pillTitle} numberOfLines={1} maxFontSizeMultiplier={1.15}>{title}</Text></>;
  // Reserved slot: never shrinks, so the title is what truncates.
  const right = primary ? <View testID="chat-window-pill-status" style={styles.pillStatusSlot}>
    <Feather name={primary.glyph} size={11} color={primary.glyph === "wifi-off" ? colors.danger : colors.gold} />
    <Text style={styles.pillStatus} numberOfLines={1} maxFontSizeMultiplier={1.1}>{primary.text}</Text>
  </View> : null;
  const hole = geometry.hole;
  const r = geometry.height / 2;
  // Cut-out mode: one pill painted around the camera with an even-odd rect-sized hole, so nothing
  // is drawn where the hardware lens sits. Safe-area mode keeps an ordinary filled pill.
  const outline = `M${r} 0H${geometry.width - r}A${r} ${r} 0 0 1 ${geometry.width - r} ${geometry.height}H${r}A${r} ${r} 0 0 1 ${r} 0Z`;
  const lens = pillLensPath(hole);
  return <Pressable
    testID="chat-window-pill"
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ expanded: open }}
    onPress={() => { haptic.select(); onToggle(); }}
    hitSlop={{ top: hitPad, bottom: hitPad }}
    style={[styles.pill, hole && styles.pillCutout, { left: geometry.left, top: geometry.top, width: geometry.width, height: geometry.height, borderRadius: r }]}
  >
    {hole ? <>
      <Svg testID="chat-window-pill-shape" width={geometry.width} height={geometry.height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Path d={`${outline}${lens}`} fill={glass.fillRaised} fillRule="evenodd" stroke={glass.hair2} strokeWidth={StyleSheet.hairlineWidth} />
      </Svg>
      {/* Pill padding (10) + flex gap (6) put the hole spacer exactly at hole.left. */}
      <View style={[styles.pillSide, { width: Math.max(0, hole.left - 16), flexShrink: 0 }]}>{left}</View>
      {/* Hardware pixels: nothing is drawn over the camera hole. */}
      <View testID="chat-window-pill-hole" style={{ width: hole.width, height: hole.height }} />
      <View style={[styles.pillSide, styles.pillSideEnd]}>{right}</View>
    </> : <><View style={styles.pillSide}>{left}</View>{right}</>}
  </Pressable>;
}

function clock(ms: number): string {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, "0")).join(":");
}

const BADGE_FONT = 11;
const SHEET_FONT = 12;
const SHEET_ICON = 14;
/** Options trigger: sliders glyph + surface word, ≥ 44 hit. */
const OPTIONS_RESERVE = 84;
const ANNOTATE_RESERVE = 94;

type FeatherName = ComponentProps<typeof Feather>["name"];

/** One flat row of the identity sheet: an icon column, the content, an optional trailing control. */
function SheetRow({ icon, child, trailing, children }: { icon: FeatherName; child?: boolean; trailing?: ReactNode; children: ReactNode }) {
  return <View testID="chat-window-sheet-row" style={[styles.sheetRow, child && styles.sheetRowChild]}>
    <Feather name={icon} size={SHEET_ICON} color={colors.textMuted} />
    <View style={styles.sheetBody}>{children}</View>
    {trailing}
  </View>;
}

/** Copies the full id to the clipboard and says so on the button itself. */
function CopyId({ id, what, testID }: { id: string; what: string; testID: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 1600);
    return () => clearTimeout(timer);
  }, [state]);
  return <Pressable
    testID={testID}
    accessibilityRole="button"
    accessibilityLabel={state === "copied" ? `${what} copied` : state === "failed" ? `Could not copy ${what}` : `Copy ${what}`}
    accessibilityLiveRegion="polite"
    onPress={() => { haptic.select(); void Clipboard.setStringAsync(id).then(() => setState("copied"), () => setState("failed")); }}
    style={styles.copy}
  >
    <Feather name={state === "copied" ? "check" : state === "failed" ? "alert-circle" : "copy"} size={SHEET_ICON} color={state === "copied" ? colors.ok : state === "failed" ? colors.warn : colors.textMuted} />
  </Pressable>;
}

/** A session id on one line, middle-truncated to the room, with the full id one tap from the clipboard. */
function IdRow({ icon, child, caption, id, chars, what, testID }: {
  icon: FeatherName; child?: boolean; caption: ReactNode; id: string; chars: number; what: string; testID: string;
}) {
  return <SheetRow icon={icon} child={child} trailing={<CopyId id={id} what={what} testID={`${testID}-copy`} />}>
    {caption}
    <Text testID={testID} style={styles.sheetId} numberOfLines={1} accessibilityLabel={`${what} ${id}`}>{sessionIdLabel(id, chars)}</Text>
  </SheetRow>;
}

/**
 * The composer grown into the window's attached rectangle: badge row + the identity sheet (flat
 * rows, provenance footer inside it) + whatever the screen already docks (workers, queue, composer).
 * One surface; nothing is repeated up top.
 */
export function WindowDock({ identity, title, options, onAnnotate, treeOpen, onTree, onClose, notice, children }: {
  identity: IdentityInput;
  title: string;
  options: ReactNode;
  onAnnotate(): void;
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
  const budget = Math.max(10, Math.floor((width - OPTIONS_RESERVE - ANNOTATE_RESERVE - CLOSE_HIT - 2 * space.sm - 40) / (BADGE_FONT * 0.6 * PixelRatio.getFontScale())));
  const lines = identityLines(identity, budget);
  // Same estimate for the sheet's mono rows: icon column, side paddings and gaps, plus the copy button on id rows.
  const sheetChars = Math.max(10, Math.floor((width - 2 * space.md - SHEET_ICON - space.sm) / (SHEET_FONT * 0.6 * PixelRatio.getFontScale())));
  const idChars = sheetChars - Math.ceil((CLOSE_HIT + space.sm) / (SHEET_FONT * 0.6 * PixelRatio.getFontScale()));
  const crumbs = [identity.hostName ?? "host unknown", identity.profile && identity.profile !== identity.harnessName ? identity.profile : undefined, identity.harnessName].filter((c): c is string => Boolean(c));
  const modelText = identity.model ? `${identity.provider ? `${identity.provider} · ` : ""}${identity.model}` : MODEL_UNKNOWN;
  const parentFirst = Boolean(identity.parentSessionId && !identity.continuedAs);
  const sessionTitle = <View style={styles.sheetTitleLine}><Text style={styles.sheetTitle} numberOfLines={1}>{title}</Text><Text style={styles.sheetCurrent}>✓ Current</Text></View>;
  return <View testID="chat-window-dock">
    {treeOpen ? <View testID="chat-window-identity" style={styles.identity}>
      <SheetRow icon="monitor">
        <Text testID="chat-window-breadcrumb" style={styles.crumbs} numberOfLines={1} accessibilityLabel={`Host ${crumbs[0]}${crumbs.length > 2 ? `, profile ${crumbs[1]}` : ""}, harness ${identity.harnessName}`}>
          {crumbs.map((crumb, index) => <Text key={index}>{index > 0 ? <Text style={styles.crumbSep}>{"  ›  "}</Text> : null}{crumb}</Text>)}
        </Text>
      </SheetRow>
      <HostStatsRow key={identity.hostId} hostId={identity.hostId} compact />
      {parentFirst && identity.parentSessionId ? <IdRow icon="corner-up-left" caption={<Text style={styles.sheetCaption}>Parent session · reported by host</Text>}
        id={identity.parentSessionId} chars={idChars} what="parent session id" testID="chat-window-parent-id" /> : null}
      {identity.sessionId
        ? <IdRow icon="message-circle" child={parentFirst} id={identity.sessionId} chars={idChars} what="session id" testID="chat-window-session-id" caption={sessionTitle} />
        : <SheetRow icon="message-circle" child={parentFirst}>{sessionTitle}<Text testID="chat-window-session-id" style={styles.sheetId}>session not attached yet</Text></SheetRow>}
      {identity.continuedAs ? <IdRow icon="corner-down-right" child caption={<Text style={styles.sheetCaption}>Continued as</Text>}
        id={identity.continuedAs} chars={idChars} what="continuation session id" testID="chat-window-continued-id" /> : null}
      <SheetRow icon="cpu">
        <Text testID="chat-window-model" style={[styles.sheetMono, !identity.model && styles.badgeUnknown]} numberOfLines={1} accessibilityLabel={`Model ${modelText}`}>{middleTruncate(modelText, sheetChars - 1)}</Text>
      </SheetRow>
      <View testID="chat-window-provenance" style={styles.provenance}>
        <Text style={styles.provenanceLine}>{identity.parentSessionId ? "Lineage: parent session reported by host" : identity.model ? "Lineage: no parent session recorded by host" : "Lineage unavailable: host has not reported it"}</Text>
        <Text testID="chat-window-model-source" style={styles.provenanceLine}>{identity.model && identity.observedAt ? `Model reported by host for this session · checked ${clock(identity.observedAt)}` : "Model unknown: host has not reported it for this session"}</Text>
        <Text style={styles.provenanceLine}>Model change unavailable: no exact-session model route in this build</Text>
      </View>
    </View> : null}
    <View testID="chat-window-badge-row" style={[styles.badgeRow, thumb.row]}>
      {options}
      <Pressable
        testID="chat-annotate"
        accessibilityRole="button"
        accessibilityLabel="Annotate this screen"
        onPress={() => { haptic.select(); onAnnotate(); }}
        style={styles.annotate}
      >
        <Feather name="edit-3" size={14} color={colors.textMuted} />
        <Text style={styles.annotateText} numberOfLines={1}>Annotate</Text>
      </Pressable>
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
  pillCutout: { backgroundColor: "transparent", borderWidth: 0 },
  pillSide: { flexDirection: "row", alignItems: "center", gap: 6, overflow: "hidden", flexShrink: 1, minWidth: 0 },
  pillSideEnd: { flex: 1, justifyContent: "flex-end" },
  pillTitle: { ...type.label, color: colors.text, flexShrink: 1, minWidth: 0, letterSpacing: 0 },
  pillStatusSlot: { flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 0, marginLeft: "auto" },
  pillStatus: { ...type.mono, fontSize: 10, lineHeight: 13, color: colors.text, flexShrink: 0 },
  identity: { paddingHorizontal: space.md, paddingTop: space.xs, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: glass.hair },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 32 },
  // One level of indent, never more: a session under its parent.
  sheetRowChild: { paddingLeft: space.lg },
  sheetBody: { flex: 1, minWidth: 0 },
  crumbs: { ...type.small, color: colors.text },
  crumbSep: { color: colors.textTertiary },
  sheetTitleLine: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  sheetTitle: { ...type.small, color: colors.text, flexShrink: 1, minWidth: 0 },
  sheetCurrent: { ...type.mono, fontSize: 11, lineHeight: 15, color: colors.textTertiary, flexShrink: 0 },
  sheetCaption: { ...type.small, color: colors.textTertiary },
  sheetId: { ...type.mono, fontSize: SHEET_FONT, lineHeight: 16, color: colors.textMuted },
  sheetMono: { ...type.mono, fontSize: SHEET_FONT, lineHeight: 16, color: colors.text },
  copy: { width: CLOSE_HIT, height: CLOSE_HIT, marginRight: -space.sm, alignItems: "center", justifyContent: "center" },
  // The provenance footer: inside the sheet, set off by a hairline, quiet and wrapping.
  provenance: { marginTop: space.xs, paddingTop: space.sm, gap: 2, borderTopWidth: StyleSheet.hairlineWidth, borderColor: glass.hair },
  provenanceLine: { ...type.mono, fontSize: 11, lineHeight: 15, color: colors.textTertiary },
  badgeRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.sm, minHeight: CLOSE_HIT },
  annotate: { minHeight: 44, minWidth: ANNOTATE_RESERVE, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, borderRadius: radius.sm },
  annotateText: { ...type.label, color: colors.textMuted, fontSize: 11, letterSpacing: 0 },
  badge: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: space.sm, borderRadius: radius.md },
  badgeLines: { flexShrink: 1, minWidth: 0 },
  badgeWho: { ...type.mono, fontSize: BADGE_FONT, lineHeight: 15, color: colors.textMuted },
  badgeModel: { ...type.mono, fontSize: BADGE_FONT, lineHeight: 15, color: colors.text },
  badgeUnknown: { color: colors.textTertiary },
  close: { width: CLOSE_HIT, height: CLOSE_HIT, alignItems: "center", justifyContent: "center" },
  closeGlyph: { width: CLOSE_GLYPH, height: CLOSE_GLYPH, borderRadius: CLOSE_GLYPH / 2, alignItems: "center", justifyContent: "center", backgroundColor: glass.quiet, borderWidth: StyleSheet.hairlineWidth, borderColor: glass.hair2 },
});
