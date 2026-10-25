import { StyleSheet, Text } from "react-native";
import Animated from "react-native-reanimated";
import { connectionPillPresentation, retryConnectionFromPill } from "../lib/a11y-connection-pill";
import { PRESS_SCALE } from "../motion";
import { bridge } from "../net/bridge";
import { store } from "../store/app";
import { colors, controlMin, radius, space, type } from "../theme";
import { GlassSurface } from "./GlassSurface";
import { enterDown, fadeOut } from "./motion-enter";
import { PressScale } from "./PressScale";

/** Shows offline errors and an explicit retry; connecting is non-actionable status. */
export function ConnectionPill() {
  const connection = store.use((s) => s.connection);
  const presentation = connectionPillPresentation(connection);
  if (!presentation) return null;
  return (
    <Animated.View entering={enterDown} exiting={fadeOut}>
      <PressScale
        accessible
        disabled={!presentation.canRetry}
        onPress={() => retryConnectionFromPill(presentation, () => bridge.retry())}
        scaleTo={PRESS_SCALE.control}
        style={styles.wrap}
        accessibilityRole={presentation.accessibilityRole}
        accessibilityLabel={presentation.accessibilityLabel}
        accessibilityState={presentation.accessibilityState}
        accessibilityLiveRegion="polite"
      >
        <GlassSurface borderRadius={radius.pill} style={styles.pill}>
          <Text accessible={false} style={styles.text} numberOfLines={2}>
            {presentation.text}
          </Text>
        </GlassSurface>
      </PressScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "center", minHeight: controlMin, marginTop: space.xs, marginBottom: space.sm, maxWidth: "90%" },
  pill: { minHeight: controlMin, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 6 },
  text: { color: colors.textMuted, ...type.small, textAlign: "center" },
});
