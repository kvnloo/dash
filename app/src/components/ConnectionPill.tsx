import { StyleSheet, Text } from "react-native";
import Animated from "react-native-reanimated";
import { PRESS_SCALE } from "../motion";
import { bridge } from "../net/bridge";
import { store } from "../store/app";
import { colors, radius, space, type } from "../theme";
import { GlassSurface } from "./GlassSurface";
import { enterDown, fadeOut } from "./motion-enter";
import { PressScale } from "./PressScale";

/** Shows only when the bridge isn't online. Tap retries immediately. */
export function ConnectionPill() {
  const connection = store.use((s) => s.connection);
  if (connection.status === "online" || connection.status === "idle") return null;
  const connecting = connection.status === "connecting";
  return (
    <Animated.View entering={enterDown} exiting={fadeOut}>
      <PressScale
        onPress={() => bridge.retry()}
        scaleTo={PRESS_SCALE.control}
        style={styles.wrap}
        accessibilityRole="button"
      >
        <GlassSurface borderRadius={radius.pill} style={styles.pill}>
          <Text style={styles.text} numberOfLines={1}>
            {connecting ? "Connecting to bridge…" : `${connection.error ?? "Offline"} · tap to retry`}
          </Text>
        </GlassSurface>
      </PressScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "center", marginTop: space.xs, marginBottom: space.sm, maxWidth: "90%" },
  pill: { paddingHorizontal: 14, paddingVertical: 6 },
  text: { color: colors.textMuted, ...type.small },
});
