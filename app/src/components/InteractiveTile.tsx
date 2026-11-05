import { DensityText as Text } from "./Density";
import { createContext, memo, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, BackHandler, findNodeHandle, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import { setStringAsync } from "expo-clipboard";
import { TileTouch } from "./TileTouch";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, { ReduceMotion, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { colors, fonts } from "../theme";
import { SNAP, fade } from "../motion";
import { useDensity } from "./Density";
import { useTileGestures, type TileAction } from "./TileGestures";
import { buildTileCommands, dispatchTileAccessibilityAction, tileAccessibilityActions, tileAccessibilityLabel, tileAccessibilityState, type TileCopyState } from "../lib/a11y-interactive-tile";

type Rect = { x: number; y: number; width: number; height: number };
type Detail = { title: string; summary: string; rect: Rect; restoreFocus(): void };
const DetailContext = createContext<(detail: Detail) => void>(() => {});

export function TileDetailProvider({ children }: { children: ReactNode }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const returnFocus = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (detail !== null || returnFocus.current === null) return;
    const frame = requestAnimationFrame(() => {
      const restore = returnFocus.current;
      returnFocus.current = null;
      restore?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [detail]);
  const dismiss = () => {
    returnFocus.current = detail?.restoreFocus ?? null;
    setDetail(null);
  };
  return <DetailContext.Provider value={setDetail}><View style={{ flex: 1 }}>
    <View style={{ flex: 1 }} accessibilityElementsHidden={detail !== null} importantForAccessibility={detail ? "no-hide-descendants" : "auto"}>{children}</View>
    {detail ? <TileDetail detail={detail} onClose={dismiss} /> : null}
  </View></DetailContext.Provider>;
}

function TileDetail({ detail, onClose }: { detail: Detail; onClose(): void }) {
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const closeRef = useRef<View>(null);
  const closing = useRef(false);
  useLayoutEffect(() => { progress.value = withTiming(1, { ...SNAP, reduceMotion: ReduceMotion.System }); }, [progress]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const handle = findNodeHandle(closeRef.current);
      if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    progress.value = withTiming(0, { ...fade, reduceMotion: ReduceMotion.System }, finished => { if (finished) runOnJS(onClose)(); });
  };
  useEffect(() => { const sub = BackHandler.addEventListener("hardwareBackPress", () => { close(); return true; }); return () => sub.remove(); });
  const style = useAnimatedStyle(() => {
    const p = reduced ? 1 : progress.value;
    return { left: detail.rect.x * (1 - p) + 12 * p, top: detail.rect.y * (1 - p) + 80 * p, width: detail.rect.width * (1 - p) + (width - 24) * p, height: detail.rect.height * (1 - p) + (height - 120) * p, opacity: reduced ? progress.value : 1, borderRadius: 14 + p * 10 };
  });
  const body = useAnimatedStyle(() => ({ opacity: Math.max(0, (progress.value - 0.5) * 2) }));
  return <View style={[StyleSheet.absoluteFill, { zIndex: 9999 }]} testID="tile-detail" accessibilityViewIsModal onAccessibilityEscape={close}>
    <Pressable accessibilityRole="button" accessibilityLabel="Dismiss tile detail" style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,.6)" }]} onPress={close} />
    <Animated.View style={[styles.sheet, style]} testID="tile-detail-morph"><Animated.View style={[{ flex: 1 }, body]}>
      <Pressable ref={closeRef} accessibilityRole="button" accessibilityLabel="Close tile detail" onPress={close} style={styles.close}><Text style={styles.text}>Close ×</Text></Pressable>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}><Text style={styles.title}>{detail.title}</Text><Text style={styles.text}>{detail.summary}</Text><Text style={styles.note}>Informational detail. No upstream action has been sent.</Text></ScrollView>
    </Animated.View></Animated.View>
  </View>;
}

/** Safe defaults: double tap pins locally for this mount; triple tap copies only on explicit intent. */
export const InteractiveTile = memo(function InteractiveTile({ title, summary, children, style, onOpen, testID, extraActions = [] }: {
  title: string; summary: string; children: ReactNode; style?: StyleProp<ViewStyle>; onOpen?(): void; testID?: string; extraActions?: TileAction[];
}) {
  const ref = useRef<View>(null);
  const detail = useContext(DetailContext);
  const { sizing, setDensity, density } = useDensity();
  const [pinned, setPinned] = useState(false);
  const [copyState, setCopyState] = useState<TileCopyState>("idle");
  const lastCopy = useRef(0);
  useEffect(() => () => { lastCopy.current++; }, []);
  const restoreFocus = () => {
    const handle = findNodeHandle(ref.current);
    if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
  };
  const open = () => {
    if (onOpen) { onOpen(); return; }
    ref.current?.measureInWindow((x, y, width, height) => detail({ title, summary, rect: { x, y, width, height }, restoreFocus }));
  };
  const pin = () => setPinned(value => !value);
  const copy = () => {
    if (!summary.trim()) return;
    const request = ++lastCopy.current;
    setCopyState("copying");
    void setStringAsync(summary).then(() => {
      if (request !== lastCopy.current) return;
      setCopyState("copied");
      AccessibilityInfo.announceForAccessibility("Summary copied");
    }, () => {
      if (request !== lastCopy.current) return;
      setCopyState("failed");
      AccessibilityInfo.announceForAccessibility("Copy failed");
    });
  };
  const cycleDensity = () => setDensity(density === "compact" ? "comfortable" : density === "comfortable" ? "rich" : "compact");
  const commands = buildTileCommands({ onOpen: open, onPin: pin, onCopy: copy, onDensity: cycleDensity, pinned, hasSummary: Boolean(summary.trim()), extras: extraActions });
  const { gesture, animatedStyle, holding } = useTileGestures({ onOpen: open, onPrimary: pin, onSecondary: copy, actions: commands });
  return <TileTouch holding={holding} onOpen={open} onPrimary={pin} onSecondary={copy}><GestureDetector gesture={gesture} touchAction="pan-y"><Animated.View ref={ref} collapsable={false} testID={testID}
    accessible accessibilityRole="button" accessibilityLabel={tileAccessibilityLabel(title, summary, pinned, copyState)} accessibilityState={tileAccessibilityState(copyState)}
    accessibilityHint="Activate for detail. Additional accessibility actions let you pin, copy when available, or change density."
    accessibilityActions={tileAccessibilityActions(commands)}
    onAccessibilityAction={event => { dispatchTileAccessibilityAction(event.nativeEvent.actionName, commands); }}
    style={[{ minWidth: 0, alignSelf: "stretch", minHeight: sizing.rowMin, shadowColor: "#000" }, style, animatedStyle]}>
    {children}{pinned || copyState !== "idle" ? <Text accessibilityLiveRegion="polite" style={styles.note}>{pinned ? "Pinned · this view" : ""}{copyState === "copying" ? " · Copying" : copyState === "copied" ? " · Copied" : copyState === "failed" ? " · Copy failed" : ""}</Text> : null}
  </Animated.View></GestureDetector></TileTouch>;
});

const styles = StyleSheet.create({
  sheet: { position: "absolute", backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  close: { alignSelf: "flex-end", minHeight: 48, minWidth: 44, justifyContent: "center", paddingHorizontal: 20 },
  title: { fontFamily: fonts.editorial, fontSize: 30, color: colors.text },
  text: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: colors.text },
  note: { fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted, padding: 4 },
});
