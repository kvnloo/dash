import { memo, type ReactNode } from "react";
import { Pressable, StyleSheet, type PressableProps, type ViewStyle } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { PRESS_SCALE, SNAP } from "../motion";

const spring = { ...SNAP, reduceMotion: ReduceMotion.System };

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
  onPressIn,
  onPressOut,
  disabled,
  children,
  ...rest
}: PressScaleProps) {
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      disabled={disabled}
      {...rest}
      style={style}
      onPressIn={(e) => {
        if (!disabled) scale.value = withSpring(scaleTo, spring);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, spring);
        onPressOut?.(e);
      }}
    >
      <Animated.View style={[styles.fill, childLayout(style), anim]}>{children}</Animated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
