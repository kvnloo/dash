import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { space } from "../theme";

/**
 * Bottom composer/search dock that rides the IME.
 * Android 15 edge-to-edge does not resize the window, so a static
 * paddingBottom is not enough — stick to KeyboardController's height.
 */
export function KeyboardDock({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardStickyView offset={{ closed: 0, opened: 0 }} style={styles.stick}>
      <View style={[{ paddingBottom: Math.max(insets.bottom, space.sm) }, style]}>{children}</View>
    </KeyboardStickyView>
  );
}

const styles = StyleSheet.create({
  stick: { width: "100%" },
});
