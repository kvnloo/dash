// Skia's Web API captures global.CanvasKit at module evaluation. App imports
// ShimmerText eagerly, so the WASM must precede *all* App imports, not just ink.
import { registerRootComponent } from "expo";
import { useEffect, useState, type ComponentType } from "react";
import { StyleSheet, Text, View } from "react-native";
import { DexSimulation } from "./components/dex/DexSimulation";
import { loadSkia } from "./components/annotate/skia-ready";
function WebBootstrap() {
  const [App, setApp] = useState<ComponentType | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let mounted = true;
    void loadSkia().then(() => import("../App")).then(module => { if (mounted) setApp(() => module.default); }).catch(() => { if (mounted) setError(true); });
    return () => { mounted = false; };
  }, []);
  if (App) return <DexSimulation><App /></DexSimulation>;
  return <View style={styles.loading}><Text accessibilityRole={error ? "alert" : "text"} style={styles.text}>{error ? "Canvas could not load. Check the connection and reload." : "Loading canvas…"}</Text></View>;
}
const styles = StyleSheet.create({ loading: { flex: 1, backgroundColor: "#080908", justifyContent: "center", alignItems: "center" }, text: { color: "#B4AFA3" } });
registerRootComponent(WebBootstrap);
