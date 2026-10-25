import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { composerSuggestions, composerTrigger, insertSuggestion } from "../lib/composer-suggestions";
import {
  EMPTY_SUGGESTIONS, currentSuggestionLoad, loadSuggestionInventory,
  selectSuggestionTarget, suggestionRequestKey, type SuggestionLoadState,
} from "../lib/composer-suggestion-request";
import { store } from "../store/app";
import { colors, radius, space, type } from "../theme";
import { PressScale } from "./PressScale";

/** Shared by the Main search/message dock and by the open Chat composer. */
export function ComposerSuggestions({ text, cursor = text.length, harness, cwd, onChange, onUsage }: {
  text: string; cursor?: number; harness?: string; cwd?: string; onChange(text: string): void; onUsage?(): void;
}) {
  const settings = store.use(s => s.settings);
  const connection = store.use(s => s.connection);
  const conversations = store.use(s => s.conversations);
  const trigger = composerTrigger(text, cursor);
  const target = selectSuggestionTarget({
    chatHarness: harness,
    selectedHarness: settings?.harness,
    connectedHarness: connection.harnesses[0]?.id,
    chatCwd: cwd,
    selectedCwd: settings?.cwd,
    connectedCwd: connection.cwd,
  });
  const address = settings?.address;
  const token = settings?.token;
  const source = address && token ? { ...target, address, token } : null;
  const key = suggestionRequestKey(source);
  const active = trigger !== null;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SuggestionLoadState>({ key: null, inventory: EMPTY_SUGGESTIONS, loading: false });

  useEffect(() => {
    if (!active) {
      setState({ key: null, inventory: EMPTY_SUGGESTIONS, loading: false });
      return;
    }
    if (!address || !token) {
      setState({ key: null, inventory: EMPTY_SUGGESTIONS, loading: false, error: "Pair with your computer to load commands and workspace files." });
      return;
    }

    const controller = new AbortController();
    setState({ key, inventory: EMPTY_SUGGESTIONS, loading: true });
    const timeout = setTimeout(() => {
      controller.abort();
      setState(previous => previous.key === key && previous.loading
        ? { key, inventory: EMPTY_SUGGESTIONS, loading: false, error: "Suggestions timed out. Check the paired bridge and try again." }
        : previous);
    }, 20000);

    void loadSuggestionInventory({ address, token, harness: target.harness, cwd: target.cwd }, controller.signal).then(
      inventory => {
        if (!controller.signal.aborted) setState({ key, inventory, loading: false });
      },
      error => {
        if (!controller.signal.aborted) setState({
          key, inventory: EMPTY_SUGGESTIONS, loading: false,
          error: error instanceof Error ? error.message : "Could not reach the bridge.",
        });
      },
    ).finally(() => clearTimeout(timeout));
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [active, key, address, token, target.harness, target.cwd, attempt]);

  if (!trigger) return null;
  // The render immediately after a chat/harness/cwd/pairing switch must never show old rows.
  const current = currentSuggestionLoad(key, state);
  const rows = composerSuggestions(trigger, current.inventory, conversations, connection.hosts);
  const warning = current.error ?? (trigger.prefix === "/" ? current.inventory.commandError : current.inventory.fileError);

  return <View style={styles.panel} accessibilityLabel="Composer suggestions">
    <Text style={styles.heading}>{trigger.prefix === "/" ? `${target.harness} commands` : "Mention a file, session, bot or agent"}</Text>
    {current.loading ? <View style={styles.loading}><ActivityIndicator size="small" color={colors.gold} /><Text style={styles.detail}>Loading from bridge…</Text></View> : null}
    {warning ? <Text accessibilityRole="alert" style={styles.detail}>{warning}</Text> : null}
    {warning && source ? <PressScale accessibilityRole="button" accessibilityLabel="Retry loading suggestions" onPress={() => setAttempt(value => value + 1)} style={styles.retry}><Text style={styles.retryText}>Retry suggestions</Text></PressScale> : null}
    <ScrollView keyboardShouldPersistTaps="always" style={styles.list}>
      {onUsage && trigger.prefix === "/" && "usage".startsWith(trigger.query) ? <PressScale accessibilityRole="button" accessibilityLabel="/usage" onPress={onUsage} style={styles.row}><Text style={styles.label}>/usage</Text><Text style={styles.detail}>This chat’s context and account quotas</Text></PressScale> : null}
      {rows.filter(row => !onUsage || row.insert !== "/usage").map(row => <PressScale key={row.id} accessibilityRole="button" accessibilityLabel={row.label} onPress={() => onChange(insertSuggestion(text, trigger, row.insert))} style={styles.row}>
        <Text numberOfLines={1} style={styles.label}>{row.label}</Text><Text numberOfLines={1} style={styles.detail}>{row.detail}</Text>
      </PressScale>)}
    </ScrollView>
    {!current.loading && !warning && rows.length === 0 ? <Text style={styles.detail}>{trigger.prefix === "/" ? "No matching commands advertised by this harness." : "No matching files, sessions, bots or agents. Try another name."}</Text> : null}
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
  retry: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: space.md },
  retryText: { ...type.small, color: colors.gold },
});
