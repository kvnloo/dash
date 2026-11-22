import { memo, useMemo, useState, type ReactNode } from "react";
import { Platform, StyleSheet, View, type PointerEvent, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector, PointerType, type HoverGesture } from "react-native-gesture-handler";
import Animated, { makeMutable, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { opacity, statusIn, statusOut } from "./motion-enter";
import { colors } from "../theme";

/**
 * S Pen (stylus) hover. A hovering pen shows a ring that follows it, controls under it glow and
 * the message under it highlights. Only a stylus that hovers (no contact) counts: touch, mouse
 * and pen contact never light anything, so phones without a pen see no change.
 *
 * Native: React Native's own pointer events are off on Android, so hover comes from
 * gesture-handler's Hover gesture (ACTION_HOVER_* with TOOL_TYPE_STYLUS). Web: the DOM pointer
 * events with pointerType "pen" (gesture-handler on web would turn every drag into a pointer
 * capture and disable text selection on the rows it wraps).
 */

const RING = 28;
const web = Platform.OS === "web";

const penX = makeMutable(0);
const penY = makeMutable(0);
const penOn = makeMutable(0);

function penHovering(event: PointerEvent): boolean {
  return event.nativeEvent.pointerType === "pen" && event.nativeEvent.buttons === 0;
}

/** The ring that follows a hovering pen. Wrap the whole app once. */
export function PenHoverRoot({ children }: { children: ReactNode }) {
  const gesture = useMemo(() => Gesture.Hover()
    .onBegin(e => {
      if (e.pointerType !== PointerType.STYLUS) return;
      penX.value = e.x; penY.value = e.y; penOn.value = 1;
    })
    .onUpdate(e => {
      if (e.pointerType !== PointerType.STYLUS) return;
      penX.value = e.x; penY.value = e.y; penOn.value = 1;
    })
    .onFinalize(() => { penOn.value = 0; }), []);
  const content = <View style={styles.root} collapsable={false}
    onPointerMove={web ? e => {
      if (penHovering(e)) { penX.value = e.nativeEvent.clientX; penY.value = e.nativeEvent.clientY; penOn.value = 1; }
      else if (penOn.value !== 0) penOn.value = 0;
    } : undefined}
    onPointerDown={web ? () => { penOn.value = 0; } : undefined}
    onPointerLeave={web ? () => { penOn.value = 0; } : undefined}
    onPointerCancel={web ? () => { penOn.value = 0; } : undefined}>
    {children}
    <PenRing />
  </View>;
  return web ? content : <GestureDetector gesture={gesture}>{content}</GestureDetector>;
}

const PenRing = memo(function PenRing() {
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(penOn.value, opacity()),
    transform: [{ translateX: penX.value - RING / 2 }, { translateY: penY.value - RING / 2 }],
  }));
  return <Animated.View testID="pen-hover-indicator" pointerEvents="none" style={[styles.ring, style]}>
    <View style={styles.dot} />
  </Animated.View>;
});

export interface PenTarget {
  /** True while a hovering pen is over the target. */
  lit: boolean;
  /** Native hover gesture; compose it with the target's own gestures. Undefined on web. */
  gesture: HoverGesture | undefined;
  /** Web pointer handlers for the target's root view. Empty on native. */
  pointer: { onPointerEnter?(event: PointerEvent): void; onPointerLeave?(event: PointerEvent): void };
}

/** Hover state of one control or message under the pen. */
export function usePenTarget(): PenTarget {
  const [lit, setLit] = useState(false);
  const gesture = useMemo(() => web ? undefined : Gesture.Hover().runOnJS(true)
    .onBegin(e => { if (e.pointerType === PointerType.STYLUS) setLit(true); })
    .onFinalize(() => setLit(false)), []);
  const pointer = useMemo(() => web ? {
    onPointerEnter: (e: PointerEvent) => { if (penHovering(e)) setLit(true); },
    onPointerLeave: (e: PointerEvent) => { if (e.nativeEvent.pointerType === "pen") setLit(false); },
  } : {}, []);
  return { lit, gesture, pointer };
}

/** Glow drawn over a control while the pen hovers it. */
export const PenGlow = memo(function PenGlow({ radius = 12 }: { radius?: number }) {
  return <Animated.View testID="pen-glow" pointerEvents="none" entering={statusIn} exiting={statusOut}
    style={[styles.glow, { borderRadius: radius }]} />;
});

/** Highlight behind a message while the pen hovers it. */
export const PenHighlight = memo(function PenHighlight() {
  return <Animated.View testID="pen-highlight" pointerEvents="none" entering={statusIn} exiting={statusOut} style={styles.highlight} />;
});

/** A message row that highlights under a hovering pen. */
export function PenHoverMessage({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const target = usePenTarget();
  const row = <View testID="pen-message" style={style} collapsable={false} {...target.pointer}>
    {target.lit ? <PenHighlight /> : null}
    {children}
  </View>;
  return target.gesture ? <GestureDetector gesture={target.gesture}>{row}</GestureDetector> : row;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  ring: {
    position: "absolute", left: 0, top: 0, width: RING, height: RING, borderRadius: RING / 2,
    borderWidth: 1.5, borderColor: `${colors.accent}cc`, backgroundColor: `${colors.accent}1f`,
    alignItems: "center", justifyContent: "center", zIndex: 10000,
    boxShadow: `0 0 12px 2px ${colors.accent}66`,
  },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.accent },
  glow: {
    ...StyleSheet.absoluteFill, borderWidth: 1, borderColor: `${colors.accent}b3`,
    backgroundColor: `${colors.accent}1f`, boxShadow: `0 0 14px 2px ${colors.accent}59`,
  },
  highlight: {
    ...StyleSheet.absoluteFill, borderRadius: 14, borderWidth: 1, borderColor: `${colors.accent}4d`,
    backgroundColor: `${colors.accent}14`,
  },
});
