import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { parseSuggestionInventory, type SuggestionInventory } from "../../../shared/suggestions";
import { composerSuggestions, composerTrigger, insertSuggestion } from "../lib/composer-suggestions";
import { store } from "../store/app";
import { colors, radius, space, type } from "../theme";
import { PressScale } from "./PressScale";

const EMPTY: SuggestionInventory = { commands: [], files: [] };

export function ComposerSuggestions({ text, cursor = text.length, harness, cwd, onChange, onUsage }: {
  text: string; cursor?: number; harness?: string; cwd?: string; onChange(text: string): void; onUsage?(): void;
}) {
  const settings = store.use(s => s.settings);
  const connection = store.use(s => s.connection);
  const conversations = store.use(s => s.conversations);
  const trigger = composerTrigger(text, cursor);
  const harnessId = harness ?? settings?.harness ?? connection.harnesses[0]?.id ?? "hermes";
  const directory = cwd ?? settings?.cwd ?? connection.cwd;
  const address = settings?.address;
  const token = settings?.token;
  const active = trigger !== null;
  const [state, setState] = useState<{ inventory: SuggestionInventory; loading: boolean; error?: string }>({ inventory: EMPTY, loading: false });
  useEffect(() => {
    if (!active) return;
    if (!address || !token) { setState({ inventory: EMPTY, loading: false, error: "Pair with your computer to load commands and workspace files." }); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    setState({ inventory: EMPTY, loading: true });
    const query = `harness=${encodeURIComponent(harnessId)}${directory ? `&cwd=${encodeURIComponent(directory)}` : ""}`;
    void fetch(`http://${address}/suggestions?${query}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(response.status === 404 ? "Update the paired bridge to load suggestions." : "Could not load suggestions. Check the paired bridge.");
      return parseSuggestionInventory(await response.json());
    }).then(inventory => { if (!controller.signal.aborted) setState({ inventory, loading: false }); }, error => {
      if (!controller.signal.aborted) setState({ inventory: EMPTY, loading: false, error: error instanceof Error ? error.message : "Could not reach the bridge." });
    }).finally(() => clearTimeout(timer));
    const timeout = setTimeout(() => setState(previous => previous.loading ? { inventory: EMPTY, loading: false, error: "Suggestions timed out. Check the paired bridge and try again." } : previous), 20000);
    return () => { controller.abort(); clearTimeout(timer); clearTimeout(timeout); };
  }, [active, harnessId, directory, address, token]);
  if (!trigger) return null;
  const rows = composerSuggestions(trigger, state.inventory, conversations, connection.hosts);
  const warning = state.error ?? (trigger.prefix === "/" ? state.inventory.commandError : state.inventory.fileError);
  return <View style={styles.panel} accessibilityLabel="Composer suggestions">
    <Text style={styles.heading}>{trigger.prefix === "/" ? `${harnessId} commands` : "Mention a file, session, bot or agent"}</Text>
    {state.loading ? <View style={styles.loading}><ActivityIndicator size="small" color={colors.gold} /><Text style={styles.detail}>Loading from bridge…</Text></View> : null}
    {warning ? <Text accessibilityRole="alert" style={styles.detail}>{warning}</Text> : null}
    <ScrollView keyboardShouldPersistTaps="always" style={styles.list}>
      {onUsage && trigger.prefix === "/" && "usage".startsWith(trigger.query) ? <PressScale accessibilityRole="button" accessibilityLabel="/usage" onPress={onUsage} style={styles.row}><Text style={styles.label}>/usage</Text><Text style={styles.detail}>This chat’s context and account quotas</Text></PressScale> : null}
      {rows.filter(row => !onUsage || row.insert !== "/usage").map(row => <PressScale key={row.id} accessibilityRole="button" accessibilityLabel={row.label} onPress={() => onChange(insertSuggestion(text, trigger, row.insert))} style={styles.row}>
        <Text numberOfLines={1} style={styles.label}>{row.label}</Text><Text numberOfLines={1} style={styles.detail}>{row.detail}</Text>
      </PressScale>)}
    </ScrollView>
    {!state.loading && !warning && rows.length === 0 ? <Text style={styles.detail}>{trigger.prefix === "/" ? "No matching commands advertised by this harness." : "No matching files, sessions, bots or agents. Try another name."}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  panel: { backgroundColor: colors.surfaceRaised, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.md, padding: space.md, gap: space.sm },
  heading: { ...type.label, color: colors.gold },
  list: { maxHeight: 240 },
  row: { minHeight: 48, alignItems: "flex-start", justifyContent: "center", paddingVertical: space.xs },
  label: { ...type.body, color: colors.text },
  detail: { ...type.small, color: colors.textMuted },
  loading: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
