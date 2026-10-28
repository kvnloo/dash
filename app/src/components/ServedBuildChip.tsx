import { useEffect, useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, controlMin, glass, radius, space, type } from "../theme";
import { METRO_ENDPOINTS, liveChipLabel, originPort, shortSha } from "../lib/live-update";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [serversOpen, setServersOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const key = (live.running?.sha ?? servedBuildKey(SERVED_BUILD)) + ":" + (live.served?.sha ?? "?");
  const visible = live.running !== null || shouldShowServedChip(TURBO, hiddenFor, SERVED_BUILD);
  // Checkout/web bundles have no baked timestamp: the matching served manifest
  // supplies the current build age without changing tracked build-info.json.
  const runningWithAge = live.running !== null && live.running.builtAtMs === null &&
    live.served !== null && live.served.sha === live.running.sha ? live.served : live.running;
  const hidden = hiddenFor === key && live.decision.kind === "current";

  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [visible]);

  if (!visible || hidden) return null;
  const update = live.decision.kind === "ready" || live.decision.kind === "reload";
  const failed = live.decision.kind === "failed";
  const heldBy = live.decision.kind === "ready" && live.decision.why === "blocked" ? live.blockedBy : null;
  const label = failed ? shortSha(live.served) + " failed to build (" + live.decision.reason + ")" :
    heldBy !== null ? "update ready - held: " + heldBy :
    live.running === null
      ? servedBuildLabel(SERVED_BUILD, now)
      : liveChipLabel(runningWithAge, live.served, now, servedAgeLabel);

  const openMenu = () => {
    if (Platform.OS === "web") {
      setServersOpen(false);
      setMenuOpen(true);
      return;
    }
    const port = live.origin === null ? null : originPort(live.origin);
    Alert.alert(
      "Live build",
      "Running " + shortSha(live.running) + ", " + (live.origin ?? "no Metro") + " serves " + shortSha(live.served) + ".",
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
          "Served bundle " + (live.running?.sha ?? SERVED_BUILD.sha ?? "unknown SHA") + ", " +
          servedAgeLabel(runningWithAge?.builtAtMs ?? SERVED_BUILD.servedAtMs, now) + "." +
          (failed ? " " + shortSha(live.served) + " failed to build (" + live.decision.reason + "). Reload disabled." :
            update ? " Newer build " + shortSha(live.served) + " is served." + (heldBy ? " Held: " + heldBy + "." : "") + " Tap to reload." : " Tap to hide.")
        }
        accessibilityHint="Long press for reload and server options"
        onPress={() => { if (!failed) update ? live.reloadNow() : setHiddenFor(key); }}
        onLongPress={openMenu}
        style={styles.touchTarget}
      >
        <View pointerEvents="none" style={[styles.chip, update && styles.chipUpdate, failed && styles.chipFailed]}>
          <Text style={[styles.label, update && styles.labelUpdate, failed && styles.labelFailed]} numberOfLines={1}>{label}</Text>
        </View>
      </Pressable>
      {Platform.OS === "web" && menuOpen && (
        <View testID="live-build-menu" style={styles.webMenu}>
          <Text style={styles.menuHeading}>Live build</Text>
          <Pressable accessibilityRole="button" onPress={() => { setMenuOpen(false); live.reloadNow(); }} style={styles.menuAction}>
            <Text style={styles.menuText}>Reload now</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setServersOpen((open) => !open)} style={styles.menuAction}>
            <Text style={styles.menuText}>Switch Metro</Text>
          </Pressable>
          {serversOpen && METRO_ENDPOINTS.map((endpoint) => (
            <Pressable key={endpoint.id} accessibilityRole="button" onPress={() => { setMenuOpen(false); live.switchTo(endpoint); }} style={styles.menuAction}>
              <Text style={styles.menuText}>{endpoint.label} :{endpoint.port}</Text>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" onPress={() => { live.setAutoReload(!live.autoReload); setMenuOpen(false); }} style={styles.menuAction}>
            <Text style={styles.menuText}>{live.autoReload ? "Turn auto-reload off" : "Turn auto-reload on"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setMenuOpen(false)} style={styles.menuAction}>
            <Text style={styles.menuText}>Close</Text>
          </Pressable>
        </View>
      )}
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
  chipFailed: { borderColor: colors.danger },
  label: { ...type.mono, color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  labelUpdate: { color: colors.accent },
  labelFailed: { color: colors.danger },
  webMenu: { alignSelf: "flex-end", backgroundColor: colors.surfaceRaised, borderColor: glass.hair2, borderWidth: 1, borderRadius: radius.md, padding: space.xs, minWidth: 220 },
  menuHeading: { color: colors.textMuted, fontSize: 12, paddingHorizontal: space.md, paddingVertical: space.sm },
  menuAction: { minHeight: controlMin, justifyContent: "center", paddingHorizontal: space.md },
  menuText: { color: colors.text, fontSize: 14 },
});
