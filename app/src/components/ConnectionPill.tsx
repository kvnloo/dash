import { Pressable, StyleSheet, Text } from "react-native";
import { bridge } from "../net/bridge";
import { store } from "../store/app";
import { colors, radius, space, type } from "../theme";
import { GlassSurface } from "./GlassSurface";

/** Shows only when the bridge isn't online. Tap retries immediately. */
export function ConnectionPill() {
  const connection = store.use((s) => s.connection);
  if (connection.status === "online" || connection.status === "idle") return null;
  const connecting = connection.status === "connecting";
  return (
    <Pressable
      onPress={() => bridge.retry()}
      style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      <GlassSurface borderRadius={radius.pill} style={styles.pill}>
        <Text style={styles.text} numberOfLines={1}>
          {connecting ? "Connecting to bridge…" : `${connection.error ?? "Offline"} · tap to retry`}
        </Text>
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "center", marginTop: space.xs, marginBottom: space.sm, maxWidth: "90%" },
  pill: { paddingHorizontal: 14, paddingVertical: 6 },
  pressed: { opacity: 0.7 },
  text: { color: colors.textMuted, ...type.small },
});
