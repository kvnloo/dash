import { memo, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { NavigationContext } from "@react-navigation/native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withTiming } from "react-native-reanimated";
import { SHIMMER_REST_MS, SHIMMER_SWEEP_MS } from "../lib/activity-shimmer";
import { settle } from "../motion";
import { opacity } from "./motion-enter";
import { AuraSweep } from "./AuraSweep";
import { turboMs } from "../turbo";
import { colors } from "../theme";

/**
 * The input bar's rim (DA-057, after OMP's docked composer in Tern: a border tinted by the session
 * accent, a shimmer band that travels while the agent works, keystroke feedback while typing).
 * Clean-room: behaviour only, drawn with Dash's accent and motion tokens.
 *
 * - idle: no rim. focused: a quiet accent hairline.
 * - typing: the hairline brightens and each keystroke flicks it brighter for one `settle`.
 * - working: a soft accent band sweeps along the rim on the shared shimmer cadence.
 * Reduce motion, a blurred screen or a background app: the band rests in the middle, nothing travels.
 * The chat turns View-driven ambient loops off (OrbActivity); the native band is Skia, so it may run there.
 */
export type AuraPhase = "idle" | "focused" | "typing" | "working";

/** Keystrokes closer together than this read as one typing run. */
const TYPING_HOLD_MS = 700;
const BAND = 0.42;
const RIM: Record<AuraPhase, number> = { idle: 0, focused: 0.28, typing: 0.62, working: 0.4 };

function subscribeApp(onChange: () => void) {
  const sub = AppState.addEventListener("change", onChange);
  return () => sub.remove();
}
const appActive = () => AppState.currentState === "active";

/** Focused screen, foreground app, motion allowed. */
function useSweepAllowed(): boolean {
  const nav = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => nav?.isFocused() ?? true);
  useEffect(() => {
    if (!nav) return;
    setFocused(nav.isFocused());
    const offFocus = nav.addListener("focus", () => setFocused(true));
    const offBlur = nav.addListener("blur", () => setFocused(false));
    return () => { offFocus(); offBlur(); };
  }, [nav]);
  const foreground = useSyncExternalStore(subscribeApp, appActive, appActive);
  return focused && foreground && !useReducedMotion();
}

export function auraPhase(working: boolean, focused: boolean, typing: boolean): AuraPhase {
  return working ? "working" : typing && focused ? "typing" : focused ? "focused" : "idle";
}

export const ComposerAura = memo(function ComposerAura({ working, focused, text }: { working: boolean; focused: boolean; text: string }) {
  const [typing, setTyping] = useState(false);
  const kick = useSharedValue(0);
  const last = useRef(text);
  useEffect(() => {
    if (last.current === text) return;
    last.current = text;
    if (!focused || !text) { setTyping(false); return; }
    setTyping(true);
    kick.value = 1;
    kick.value = withTiming(0, settle);
    const hold = setTimeout(() => setTyping(false), turboMs(TYPING_HOLD_MS));
    return () => clearTimeout(hold);
  }, [text, focused, kick]);
  const phase = auraPhase(working, focused, typing);

  const rim = useSharedValue(RIM[phase]);
  useEffect(() => { rim.value = withTiming(RIM[phase], opacity()); }, [phase, rim]);
  const rimStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, rim.value + kick.value * 0.38) }));

  const [width, setWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setWidth(previous => previous === next ? previous : next);
  };
  const band = Math.max(1, Math.round(width * BAND));
  const running = useSweepAllowed();
  const sweep = useSharedValue(0.5);
  const travelling = phase === "working" && running && width > 0;
  useEffect(() => {
    if (!travelling) { cancelAnimation(sweep); sweep.value = 0.5; return; }
    sweep.value = 0;
    sweep.value = withRepeat(withDelay(turboMs(SHIMMER_REST_MS), withTiming(1, { duration: turboMs(SHIMMER_SWEEP_MS), easing: Easing.linear })), -1, false);
    return () => cancelAnimation(sweep);
  }, [travelling, sweep]);

  return <View pointerEvents="none" style={styles.wrap} onLayout={onLayout} testID="composer-aura">
    <Animated.View testID={`composer-aura-${phase}`} style={[styles.rim, rimStyle]} />
    {phase === "working" && width > 0 ? <AuraSweep progress={sweep} width={width} band={band} /> : null}
  </View>;
});

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, top: 0, height: 14, overflow: "hidden" },
  rim: { position: "absolute", left: 18, right: 18, top: 0, height: 1.5, borderRadius: 1, backgroundColor: colors.accent },
});
