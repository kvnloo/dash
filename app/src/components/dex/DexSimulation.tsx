import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { DEX_OFF, getState, subscribe, type DexState } from "../../lib/dex";
import { DashPad } from "./DashPad";

export function DexSimulation({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DexState>(DEX_OFF);
  useEffect(() => {
    const off = subscribe(setState);
    void getState().then(setState);
    return off;
  }, []);
  const simulated = state.source === "web-simulation" && state.mode !== "off";
  return <View style={styles.root}>
    <View testID={simulated ? "dex-tv" : undefined} style={styles.tv}>
      {simulated ? <Text style={styles.label}>Dash TV · {state.tv?.w} × {state.tv?.h}</Text> : null}
      {children}
    </View>
    {simulated && state.padOpen ? <View style={styles.pad}><DashPad /></View> : null}
  </View>;
}
const styles = StyleSheet.create({ root: { flex: 1, flexDirection: "row", backgroundColor: "#000" }, tv: { flex: 1, minWidth: 0 }, pad: { width: "38%", borderLeftWidth: 1, borderLeftColor: "#555" }, label: { color: "#ccc", padding: 8 } });
