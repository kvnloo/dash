import { memo, type ReactNode } from "react";
import { Pressable, type PressableProps } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { PRESS_SCALE, SNAP } from "../motion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const spring = { ...SNAP, reduceMotion: ReduceMotion.System };

export type PressScaleProps = PressableProps & {
  scaleTo?: number;
  children?: ReactNode;
};

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
    <AnimatedPressable
      disabled={disabled}
      {...rest}
      style={(state: { pressed: boolean }) => [typeof style === "function" ? style(state) : style, anim]}
      onPressIn={(e) => {
        if (!disabled) scale.value = withSpring(scaleTo, spring);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, spring);
        onPressOut?.(e);
      }}
    >
      {children}
    </AnimatedPressable>
  );
});
