import { useEffect, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { groupKevinItems, parseKevinBatch, type KevinBatch } from "../../../shared/supervision";
import { store } from "../store/app";
import { colors, radius, space, type } from "../theme";

export function NeedsKevin() {
  const settings = store.use(s => s.settings);
  const [batch, setBatch] = useState<KevinBatch | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setBatch(null);
    if (!settings) { setError("Pair with the supervision host to read the batch."); return; }
    let disposed = false;
    let controller: AbortController | undefined;
    const load = async () => {
      if (AppState.currentState !== "active") return;
      controller?.abort();
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 10000);
      try {
        const response = await fetch(`http://${settings.address}/supervision`, { method: "GET", headers: { Authorization: `Bearer ${settings.token.trim()}` }, signal: controller.signal });
        if (!response.ok) throw new Error(`Supervision unavailable (HTTP ${response.status}).`);
        const raw: unknown = await response.json();
        const parsed = typeof raw === "object" && raw !== null && "needs_kevin" in raw ? parseKevinBatch(raw.needs_kevin) : null;
        if (!parsed) throw new Error("Invalid supervision batch.");
        if (!disposed) { setBatch(parsed); setError(""); }
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : "Could not read supervision."); }
      finally { clearTimeout(timeout); }
    };
    void load();
    const interval = setInterval(() => void load(), 60000);
    const subscription = AppState.addEventListener("change", state => { if (state === "active") void load(); });
    return () => { disposed = true; clearInterval(interval); subscription.remove(); controller?.abort(); };
  }, [settings, refresh]);
  return <View testID="needs-kevin" style={styles.group}>
    <View style={styles.header}><Text accessibilityRole="header" style={styles.heading}>Needs Kevin{batch ? ` · ${batch.size}` : ""}</Text><Pressable accessibilityRole="button" accessibilityLabel="Refresh Needs Kevin" onPress={() => setRefresh(n => n + 1)} style={styles.refresh}><Text style={styles.small}>Refresh</Text></Pressable></View>
    <Text style={styles.small}>Batched for your next deep-work block. Read-only; never blocks agents.</Text>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error} {batch ? "Showing last snapshot." : ""}</Text> : null}
    {batch ? <Text style={styles.small}>Snapshot {batch.generated_at}{Date.now() - Date.parse(batch.generated_at) > 20 * 60000 ? " · stale (timer may be stopped)" : ""}</Text> : null}
    {!batch && !error ? <Text style={styles.small}>Loading supervision…</Text> : null}
    {batch && batch.size === 0 ? <Text style={styles.body}>No decisions waiting.</Text> : null}
    {groupKevinItems(batch?.items ?? []).map(group => <View key={group.decision} style={styles.group}>
      <Text style={styles.heading}>{group.decision} · {group.items.length}</Text>
      {group.items.map(item => <View key={item.id} style={styles.card}>
        <Text style={styles.heading}>{item.goal || item.worker}</Text>
        <Text selectable style={styles.small}>{item.worker} · {item.phase}</Text>
        <Text style={styles.body}>{item.why}</Text>
        <Text style={styles.small}>Recommended: {item.recommended_action}</Text>
        <Text style={styles.small}>Options: {item.options.join(" / ")}</Text>
        <Text selectable style={styles.small}>Evidence: {item.evidence_path}</Text>
      </View>)}
    </View>)}
    <Text style={styles.small}>Record decisions in worker-decisions.jsonl on the host; the next timer tick clears them. No resume, kill or approval controls here.</Text>
  </View>;
}
const styles = StyleSheet.create({
  group: { gap: space.md }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heading: { color: colors.text, ...type.cardTitle, flexShrink: 1 }, body: { color: colors.ink, ...type.body }, small: { color: colors.ink2, ...type.small },
  error: { color: colors.warn, ...type.small }, refresh: { minHeight: 44, minWidth: 44, justifyContent: "center", paddingHorizontal: space.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hair, padding: space.lg, gap: space.sm },
});
