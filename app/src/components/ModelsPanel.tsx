import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { parseRoles, type ResolvedRole } from "../../../shared/model-roles";
import { executionToken } from "../lib/bridge-auth";
import { store } from "../store/app";
import { colors, space, type } from "../theme";

export function ModelsPanel() {
  const settings = store.use(state => state.settings);
  const [roles, setRoles] = useState<ResolvedRole[]>([]);
  const [error, setError] = useState("");
  const [revision, refresh] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    if (!settings) { setError("Pair with a bridge to see its models."); return; }
    setError("");
    void (async () => {
      try {
        const token = await executionToken(settings);
        const response = await fetch(`http://${settings.address}/models`, { headers: { authorization: `Bearer ${token}` }, signal: abort.signal });
        const rows = response.ok ? parseRoles(await response.json()) : null;
        if (!rows) throw new Error("Models unavailable. Update or reconnect your bridge.");
        if (!abort.signal.aborted) setRoles(rows);
      } catch { if (!abort.signal.aborted) setError("Models unavailable. Update or reconnect your bridge."); }
    })();
    return () => abort.abort();
  }, [settings, revision]);
  return <View>
    <Text style={styles.help}>Read-only host assignments · Dash → OMP → defaults. Local health is endpoint reachability; cloud health is unknown, not assumed healthy.</Text>
    <Pressable accessibilityRole="button" onPress={() => refresh(value => value + 1)}><Text style={styles.refresh}>Refresh models</Text></Pressable>
    {error ? <Text accessibilityRole="alert" style={styles.help}>{error}</Text> : null}
    {roles.map(row => <View key={row.role} style={styles.row}>
      <Text style={styles.title}>{row.role} · {row.source} · {row.health}</Text>
      <Text selectable style={styles.model}>{row.model || "Unassigned · needs a kind-specific provider"}</Text>
      <Text style={styles.help}>{row.purpose}</Text>
      {row.fallback.length ? <Text style={styles.help}>Fallback: {row.fallback.join(" → ")}</Text> : null}
    </View>)}
  </View>;
}
const styles = StyleSheet.create({
  row: { paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { ...type.cardTitle, color: colors.text },
  model: { ...type.mono, color: colors.text, marginTop: 6 },
  help: { ...type.small, color: colors.textMuted, marginTop: 6 },
  refresh: { ...type.body, color: colors.accent, paddingVertical: 12 },
});
