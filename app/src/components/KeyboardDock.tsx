import { useEffect, type ReactNode } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { KeyboardEvents, useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { keyboardInset } from "../lib/keyboard-inset";
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

/**
 * Content above a KeyboardDock. The dock only translates, so without this the list keeps its
 * full height and the newest messages (your send, the streamed reply) sit behind the IME.
 * Pads the content by the keyboard height on the UI thread and calls `onOpen` once it is up.
 */
export function KeyboardInsetView({
  children,
  style,
  onOpen,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onOpen?: () => void;
}) {
  const { height } = useReanimatedKeyboardAnimation();
  const inset = useAnimatedStyle(() => ({ paddingBottom: keyboardInset(height.value) }));
  useEffect(() => {
    if (!onOpen) return;
    const sub = KeyboardEvents.addListener("keyboardDidShow", () => onOpen());
    return () => sub.remove();
  }, [onOpen]);
  return <Animated.View style={[style, inset]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  stick: { width: "100%" },
});
