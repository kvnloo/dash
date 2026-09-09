import { Pressable, StyleSheet, Text } from "react-native";
import { bridge } from "../net/bridge";
import { store } from "../store/app";
import { colors, radius, space, type } from "../theme";

/** Shows only when the bridge isn't online. Tap retries immediately. */
export function ConnectionPill() {
  const connection = store.use((s) => s.connection);
  if (connection.status === "online" || connection.status === "idle") return null;
  const connecting = connection.status === "connecting";
  return (
    <Pressable
      onPress={() => bridge.retry()}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      <Text style={styles.text} numberOfLines={1}>
        {connecting ? "Connecting to bridge…" : `${connection.error ?? "Offline"} · tap to retry`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: space.xs,
    marginBottom: space.sm,
    maxWidth: "90%",
  },
  pressed: { opacity: 0.7 },
  text: { color: colors.textMuted, ...type.small },
});
