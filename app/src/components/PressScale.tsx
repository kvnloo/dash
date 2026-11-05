import { memo, useContext, useEffect, useMemo, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, type PressableProps, type ViewStyle } from "react-native";
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

const spring = { ...press, reduceMotion: ReduceMotion.System };

export type PressScaleProps = PressableProps & {
  scaleTo?: number;
  /** Web chat rows need direct Pressability events while the ancestor pager handles swipes. */
  webPressable?: boolean;
  children?: ReactNode;
};

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
  webPressable = false,
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
  const gesture = useMemo(() => Gesture.Manual().enabled(!disabled)
    // The pager latches a completed swipe through release so Pressable cannot turn that
    // release into a tap. This child sees the next pointer down even while the parent Pan
    // waits for Manual to fail, so it is the reliable boundary for a fresh sequence.
    .onTouchesDown(() => {
      if (swiping) swiping.value = false;
      scale.value = withTiming(target, spring);
    })
    .onTouchesUp((_event, manager) => { scale.value = withTiming(1, spring); manager.fail(); })
    .onTouchesCancelled((_event, manager) => { scale.value = withTiming(1, spring); manager.fail(); }), [disabled, target, scale, swiping]);
  // A press released by unmount (view switch) must not keep animating a dead view.
  useEffect(() => () => cancelAnimation(scale), [scale]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const pressable = (
    <Pressable
      disabled={disabled}
      {...rest}
      style={style}
      onPress={e => { if (!swiping?.value) onPress?.(e); }}
      onLongPress={e => { if (!swiping?.value) onLongPress?.(e); }}
      onPressIn={(e) => {
        // Without the web Manual recognizer, this is the next real pointer down.
        // Clear the pager swipe latch before the row can receive its next tap.
        if (Platform.OS === "web" && webPressable && swiping) swiping.value = false;
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        onPressOut?.(e);
      }}
    >
      <Animated.View style={[styles.fill, childLayout(style), anim]}>{children}</Animated.View>
    </Pressable>
  );
  // Gesture.Manual on web can defer/cancel Pressable press-in until release;
  // a hold timer started there never fires. Keep the native gesture unchanged.
  return Platform.OS === "web" && webPressable
    ? pressable
    : <GestureDetector gesture={gesture}>{pressable}</GestureDetector>;
});

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
