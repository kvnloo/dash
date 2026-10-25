import { memo, useContext, useEffect, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, type PressableProps, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  ReduceMotion,
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
  accessibilityState,
  children,
  ...rest
}: PressScaleProps) {
  const swiping = useContext(PagerGestureContext);
  const scale = useSharedValue(1);
  useEffect(() => { if (disabled) scale.value = 1; }, [disabled, scale]);
  const gesture = Gesture.Manual().enabled(!disabled)
    .onTouchesDown(() => { scale.value = withTiming(scaleTo, spring); })
    .onTouchesUp((_event, manager) => { scale.value = withTiming(1, spring); manager.fail(); })
    .onTouchesCancelled((_event, manager) => { scale.value = withTiming(1, spring); manager.fail(); });
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <GestureDetector gesture={gesture}><Pressable
      disabled={disabled}
      {...rest}
      accessibilityState={{ ...accessibilityState, disabled: Boolean(disabled) }}
      style={style}
      onPress={e => { if (!swiping?.value) onPress?.(e); }}
      onLongPress={e => { if (!swiping?.value) onLongPress?.(e); }}
      onPressIn={(e) => {
        if (Platform.OS === "web") scale.value = withTiming(scaleTo, spring);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (Platform.OS === "web") scale.value = withTiming(1, spring);
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
