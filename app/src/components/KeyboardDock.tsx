import type { ReactNode } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { space } from "../theme";

/**
 * Bottom composer/search dock that rides the IME.
 * Android 15 / Expo Go do not resize the window, so paddingBottom is not enough.
 * Translate with KeyboardController's UI-thread keyboard height (negative when open).
 */
export function KeyboardDock({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const { height, progress } = useReanimatedKeyboardAnimation();
  const lift = useAnimatedStyle(() => {
    const closedPad = Math.max(insets.bottom, space.sm);
    return {
      transform: [{ translateY: height.value }],
      paddingBottom: closedPad * (1 - progress.value),
    };
  });

  return <Animated.View style={[styles.stick, style, lift]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  stick: { width: "100%" },
});
