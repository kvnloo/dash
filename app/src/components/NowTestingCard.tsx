import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic } from "../haptics";
import { openAppRoute } from "../lib/app-route-open";
import { NOW_TESTING, NOW_TESTING_SEEN_KEY } from "../lib/now-testing";
import { store } from "../store/app";
import { colors, controlMin, glass, radius, space, type } from "../theme";
import { NAV_CHROME_HEIGHT } from "./golden-nav";
import { PressScale } from "./PressScale";

/**
 * "Now testing: <feature>" after a turbo promotion. Shown once per promoted commit (until opened or
 * dismissed); its button opens the changed screen through the same routes as dash:// deep links.
 */
export function NowTestingCard() {
  const insets = useSafeAreaInsets();
  const paired = store.use(s => s.hydrated && s.settings !== null);
  const [seen, setSeen] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!NOW_TESTING) return;
    let alive = true;
    AsyncStorage.getItem(NOW_TESTING_SEEN_KEY).then(value => { if (alive) setSeen(value); }, () => { if (alive) setSeen(null); });
    return () => { alive = false; };
  }, []);

  const testing = NOW_TESTING;
  if (!testing || !paired || seen === undefined || seen === testing.sha) return null;

  const done = () => {
    setSeen(testing.sha);
    AsyncStorage.setItem(NOW_TESTING_SEEN_KEY, testing.sha).catch(() => { /* shows again next launch */ });
  };
  const open = () => {
    haptic.select();
    done();
    if (testing.route) openAppRoute(testing.route);
  };

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + NAV_CHROME_HEIGHT + space.xs }]}>
      <View testID="now-testing-card" accessibilityRole="summary" accessibilityLabel={`Now testing: ${testing.feature}`} style={styles.card}>
        <Text style={styles.kicker}>NOW TESTING · {testing.sha.slice(0, 7)}</Text>
        <Text style={styles.feature} numberOfLines={3}>{testing.feature}</Text>
        {testing.steps ? <Text style={styles.steps} numberOfLines={3}>{testing.steps}</Text> : null}
        <View style={styles.row}>
          <PressScale accessibilityRole="button" accessibilityLabel="Dismiss now testing" onPress={() => { haptic.tap(); done(); }} style={styles.secondary}>
            <Text style={styles.secondaryText}>Dismiss</Text>
          </PressScale>
          {testing.route ? (
            <PressScale accessibilityRole="button" accessibilityLabel={`Open ${testing.route} to test`} accessibilityHint={testing.link ?? undefined} onPress={open} style={styles.primary}>
              <Text style={styles.primaryText}>Take me there</Text>
            </PressScale>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: space.md, right: space.md, zIndex: 50, elevation: 50 },
  card: { backgroundColor: colors.bg, borderColor: colors.gold, borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.xs },
  kicker: { ...type.label, color: colors.gold },
  feature: { ...type.heading, color: colors.text },
  steps: { ...type.small, color: colors.textMuted },
  row: { flexDirection: "row", justifyContent: "flex-end", gap: space.sm, marginTop: space.xs },
  primary: { minHeight: controlMin, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  primaryText: { ...type.heading, color: colors.onAccent },
  secondary: { minHeight: controlMin, paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: glass.hair2, alignItems: "center", justifyContent: "center" },
  secondaryText: { ...type.heading, color: colors.text },
});
