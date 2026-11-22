// Visible provenance for agent UI control (docs/specs/ui-control.md): every command an agent sends
// shows here with Stop (turn Agent control off) and Dismiss. Plain text only; never blocks touches
// outside its own controls.
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ACTIVITY_MS, agentControl, dismissActivity, setAgentControl } from "../store/agent-control";
import { colors, controlMin, radius, space, type } from "../theme";

export function AgentControlLayer() {
  const activity = agentControl.use(s => s.activity);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!activity) return;
    const timer = setTimeout(() => {
      if (agentControl.get().activity?.seq === activity.seq) dismissActivity();
    }, ACTIVITY_MS);
    return () => clearTimeout(timer);
  }, [activity]);

  if (!activity) return null;
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.layer, { paddingTop: insets.top + space.sm }]}>
      <View testID="agent-activity" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.chip}>
        <Text testID="agent-activity-text" numberOfLines={2} style={[styles.text, activity.status !== "done" && styles.muted]}>{activity.text}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Stop agent control" onPress={() => setAgentControl(false)} style={styles.action}>
          <Text style={styles.stop}>Stop</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss agent activity" onPress={dismissActivity} style={styles.action}>
          <Text style={styles.text}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { alignItems: "center", zIndex: 1000, elevation: 1000 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: space.xs, maxWidth: 440, marginHorizontal: space.md,
    paddingLeft: space.md, borderRadius: radius.pill, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.gold,
  },
  text: { ...type.small, color: colors.ink, flexShrink: 1 },
  muted: { color: colors.ink2 },
  stop: { ...type.label, color: colors.gold },
  action: { minHeight: controlMin, minWidth: controlMin, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xs },
});
