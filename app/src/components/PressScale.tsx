import { memo, useContext, useEffect, useMemo, type ReactNode } from "react";
import { Pressable, StyleSheet, type PressableProps, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { PagerGestureContext } from "./pager-gesture";
import { PRESS_SCALE, press, pressScaleFor } from "../motion";
import { PenGlow, usePenTarget } from "./PenHover";

const spring = { ...press, reduceMotion: ReduceMotion.System };

export type PressScaleProps = PressableProps & {
  scaleTo?: number;
  children?: ReactNode;
};

function cornerRadius(style: PressableProps["style"]): number | undefined {
  if (style == null || typeof style === "function") return undefined;
  const radius = StyleSheet.flatten(style)?.borderRadius;
  return typeof radius === "number" ? radius : undefined;
}

function childLayout(style: PressableProps["style"]): ViewStyle | undefined {
  if (style == null || typeof style === "function") return undefined;
  const flat = StyleSheet.flatten(style);
  if (flat == null) return undefined;
  const next: ViewStyle = {};
  if (flat.flexDirection != null) next.flexDirection = flat.flexDirection;
  if (flat.alignItems != null) next.alignItems = flat.alignItems;
  if (flat.justifyContent != null) next.justifyContent = flat.justifyContent;
  if (flat.gap != null) next.gap = flat.gap;
  if (flat.rowGap != null) next.rowGap = flat.rowGap;
  if (flat.columnGap != null) next.columnGap = flat.columnGap;
  return next;
}

/** UI-thread press squash. Use instead of opacity pressed styles. */
export const PressScale = memo(function PressScale({
  scaleTo = PRESS_SCALE.row,
  style,
  onPress,
  onLongPress,
  onPressIn,
  onPressOut,
  disabled,
  children,
  ...rest
}: PressScaleProps) {
  const swiping = useContext(PagerGestureContext);
  const scale = useSharedValue(1);
  // Reduce motion: no squash at all (an instant 0.985 jump is still motion).
  const target = pressScaleFor(scaleTo, useReducedMotion());
  // One gesture per mount, not per render: a new Gesture makes GestureDetector re-attach
  // its native handler and Reanimated event worklets on every parent render.
  const pen = usePenTarget();
  const squash = useMemo(() => Gesture.Manual().enabled(!disabled)
    // The pager latches a completed swipe through release so Pressable cannot turn that
    // release into a tap. This child sees the next pointer down even while the parent Pan
    // waits for Manual to fail, so it is the reliable boundary for a fresh sequence.
    .onTouchesDown(() => {
      if (swiping) swiping.value = false;
      scale.value = withTiming(target, spring);
    })
    .onTouchesUp((_event, manager) => { scale.value = withTiming(1, spring); manager.fail(); })
    .onTouchesCancelled((_event, manager) => { scale.value = withTiming(1, spring); manager.fail(); }), [disabled, target, scale, swiping]);
  // A hovering S Pen lights the control (PenHover); its hover never presses.
  const gesture = useMemo(() => pen.gesture ? Gesture.Simultaneous(squash, pen.gesture) : squash, [squash, pen.gesture]);
  // A press released by unmount (view switch) must not keep animating a dead view.
  useEffect(() => () => cancelAnimation(scale), [scale]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <GestureDetector gesture={gesture}><Pressable
      disabled={disabled}
      {...pen.pointer}
      {...rest}
      style={style}
      onPress={e => { if (!swiping?.value) onPress?.(e); }}
      onLongPress={e => { if (!swiping?.value) onLongPress?.(e); }}
      onPressIn={(e) => {
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        onPressOut?.(e);
      }}
    >
      {pen.lit && !disabled ? <PenGlow radius={cornerRadius(style)} /> : null}
      <Animated.View style={[styles.fill, childLayout(style), anim]}>{children}</Animated.View>
    </Pressable></GestureDetector>
  );
});

const styles = StyleSheet.create({
  // Grow into a sized slot, but keep basis auto. `flex: 1` is basis 0 on native (Yoga), so in a
  // content-sized row (a chip in a horizontal ScrollView) the wrapper collapsed to 0 wide and Android
  // clipped the label away: empty outlines. Web never showed it: CSS sizes that row from its content.
  fill: {
    flexGrow: 1,
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
