import { useEffect } from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";
import { bootstrapDebugScenario } from "./controller";
import { exposeDebugApi, initialDebugScenario, isDebugActive, parseDebugDeepLink } from "./expose";
import { debugAutoNav, debugShowBanner, readWebDebugParams } from "./mode";
import { flushPendingDebugNavigation } from "./nav";
import { debugUi, resetDebugUi } from "./ui-store";
import { colors, type } from "../theme";

interface Props {
  onNavigationReady?: () => void;
}

export function DebugHost({ onNavigationReady }: Props) {
  const active = isDebugActive();

  useEffect(() => {
    if (!active) return;
    resetDebugUi();
    exposeDebugApi();

    void (async () => {
      const web = readWebDebugParams();
      const scenario = initialDebugScenario();
      const shouldAutoNav = scenario && (web.autoNav || debugAutoNav());

      if (shouldAutoNav) {
        await bootstrapDebugScenario(scenario);
      } else {
        await bootstrapDebugScenario(undefined);
      }
    })();
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const sub = Linking.addEventListener("url", ({ url }: { url: string }) => {
      const scenario = parseDebugDeepLink(url);
      if (scenario) void bootstrapDebugScenario(scenario);
    });
    return () => sub.remove();
  }, [active]);

  useEffect(() => {
    if (!active || !onNavigationReady) return;
    flushPendingDebugNavigation();
  }, [active, onNavigationReady]);

  if (!active || !debugShowBanner()) return null;

  const ready = debugUi.use((s) => s.ready);

  return (
    <View style={styles.banner} pointerEvents="none">
      <Text style={styles.bannerText}>DEBUG {ready ? "ready" : "…"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: Platform.OS === "web" ? 8 : 48,
    right: 8,
    zIndex: 9999,
    backgroundColor: "rgba(180,40,40,0.85)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  bannerText: { color: "#fff", ...type.small, fontWeight: "700", fontSize: 10 },
});
