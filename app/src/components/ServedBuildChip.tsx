import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, controlMin, glass, radius, space, type } from "../theme";
import { METRO_ENDPOINTS, RUNNING_BUILD, liveChipLabel, originPort, shortSha } from "../lib/live-update";
import { useLiveUpdate } from "../lib/use-live-update";
import {
  SERVED_BUILD,
  TURBO,
  servedAgeLabel,
  servedBuildKey,
  servedBuildLabel,
  shouldShowServedChip,
} from "../turbo";

/**
 * Mount inside SafeAreaProvider near the app root. Shows which build this bundle is, and
 * `old → new` once the Metro it came from serves a newer one. Never renders in builds without
 * a live Metro (release APK, web, local checkout).
 */
export function ServedBuildChip() {
  const insets = useSafeAreaInsets();
  const live = useLiveUpdate();
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const key = servedBuildKey(SERVED_BUILD) + ":" + (live.served?.sha ?? "?");
  const visible = RUNNING_BUILD !== null || shouldShowServedChip(TURBO, hiddenFor, SERVED_BUILD);
  const hidden = hiddenFor === key && live.decision.kind === "current";

  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [visible]);

  if (!visible || hidden) return null;
  const update = live.decision.kind !== "current";
  const heldBy = live.decision.kind === "ready" && live.decision.why === "blocked" ? live.blockedBy : null;
  const label = heldBy !== null ? "update ready - held: " + heldBy :
    RUNNING_BUILD === null
      ? servedBuildLabel(SERVED_BUILD, now)
      : liveChipLabel(RUNNING_BUILD, live.served, now, servedAgeLabel);

  const openMenu = () => {
    const port = live.origin === null ? null : originPort(live.origin);
    Alert.alert(
      "Live build",
      "Running " + shortSha(RUNNING_BUILD) + ", " + (live.origin ?? "no Metro") + " serves " + shortSha(live.served) + ".",
      [
        { text: "Reload now", onPress: live.reloadNow },
        {
          text: "Switch Metro",
          onPress: () =>
            Alert.alert(
              "Switch Metro",
              "Loads the other server and reloads. Drafts persist.",
              [
                ...METRO_ENDPOINTS.map((endpoint) => ({
                  text: endpoint.label + " :" + endpoint.port + (endpoint.port === port ? " (current)" : ""),
                  onPress: () => live.switchTo(endpoint),
                })),
                { text: "Cancel", style: "cancel" as const },
              ],
            ),
        },
        {
          text: live.autoReload ? "Turn auto-reload off" : "Turn auto-reload on",
          onPress: () => live.setAutoReload(!live.autoReload),
        },
      ],
      { cancelable: true },
    );
  };

  return (
    <View pointerEvents="box-none" style={[styles.overlay, { top: insets.top + space.xs }]}>
      <Pressable
        testID="turbo-served-build"
        accessibilityRole="button"
        accessibilityLabel={
          "Served bundle " + (RUNNING_BUILD?.sha ?? SERVED_BUILD.sha ?? "unknown SHA") + ", " +
          servedAgeLabel(RUNNING_BUILD?.builtAtMs ?? SERVED_BUILD.servedAtMs, now) + "." +
          (update ? " Newer build " + shortSha(live.served) + " is served." + (heldBy ? " Held: " + heldBy + "." : "") + " Tap to reload." : " Tap to hide.")
        }
        accessibilityHint="Long press for reload and server options"
        onPress={() => (update ? live.reloadNow() : setHiddenFor(key))}
        onLongPress={openMenu}
        style={styles.touchTarget}
      >
        <View pointerEvents="none" style={[styles.chip, update && styles.chipUpdate]}>
          <Text style={[styles.label, update && styles.labelUpdate]} numberOfLines={1}>{label}</Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: "absolute", right: space.sm, zIndex: 1000 },
  touchTarget: { minWidth: controlMin, minHeight: controlMin, alignItems: "center", justifyContent: "center" },
  chip: {
    backgroundColor: colors.bg,
    borderColor: glass.hair2,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  chipUpdate: { borderColor: colors.accent },
  label: { ...type.mono, color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  labelUpdate: { color: colors.accent },
});
