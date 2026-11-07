import { memo, useContext, useEffect, useMemo, type ReactNode } from "react";
import { Pressable, StyleSheet, type PressableProps, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { PagerGestureContext } from "./pager-gesture";
import { PRESS_SCALE, press } from "../motion";

const spring = { ...press, reduceMotion: ReduceMotion.System };

export type PressScaleProps = PressableProps & {
  scaleTo?: number;
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
  // One gesture per mount, not per render: a new Gesture makes GestureDetector re-attach
  // its native handler and Reanimated event worklets on every parent render.
  const gesture = useMemo(() => Gesture.Manual().enabled(!disabled)
    .onTouchesDown(() => { scale.value = withTiming(scaleTo, spring); })
    .onTouchesUp((_event, manager) => { scale.value = withTiming(1, spring); manager.fail(); })
    .onTouchesCancelled((_event, manager) => { scale.value = withTiming(1, spring); manager.fail(); }), [disabled, scaleTo, scale]);
  // A press released by unmount (view switch) must not keep animating a dead view.
  useEffect(() => () => cancelAnimation(scale), [scale]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <GestureDetector gesture={gesture}><Pressable
      disabled={disabled}
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
      <Animated.View style={[styles.fill, childLayout(style), anim]}>{children}</Animated.View>
    </Pressable></GestureDetector>
  );
});

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
