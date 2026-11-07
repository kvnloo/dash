import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { formatTool } from "../../../shared/tool-format";
import type { ToolView } from "../lib/reply-details";
import { store } from "../store/app";
import { colors, type } from "../theme";

/** Line/chunk virtualization: megabyte results never become a single mounted Text. */
export function ToolInspector({ tool, close, request }: { tool: ToolView; close(): void; request?: (id: string) => void }) {
  const f = useMemo(() => formatTool(tool), [tool]);
  const settings = store.use(s => s.settings);
  const [tab, setTab] = useState<"Arguments" | "Output" | "Diff" | "File">("Output");
  const [file, setFile] = useState("");
  const [notice, setNotice] = useState("");
  const text = tab === "Arguments" ? f.args : tab === "Diff" ? f.diff ?? "No diff available" : tab === "File" ? file : f.output || (tool.status === "live" ? "Waiting for output…" : "No output");
  const rows = useMemo(() => text.split("\n").flatMap(line => { const rows: string[] = []; for (let i = 0; i < Math.max(1, line.length); i += 240) rows.push(line.slice(i, i + 240)); return rows; }), [text]);
  const openFile = async () => {
    if (!settings || !f.path) return;
    setTab("File"); setFile("Loading…");
    try {
      const response = await fetch(`http://${settings.address}/files?format=text&path=${encodeURIComponent(f.path)}`, { headers: { Authorization: `Bearer ${settings.token}` }, signal: AbortSignal.timeout(5000) });
      setFile(response.ok ? await response.text() : `File unavailable (HTTP ${response.status})`);
    } catch { setFile("File unavailable"); }
  };
  return <Modal visible animationType="slide" onRequestClose={close}>
    <View style={styles.root}>
      <Pressable accessibilityRole="button" onPress={close}><Text style={styles.action}>Close tool details</Text></Pressable>
      <Text style={styles.title}>{tool.name} · {f.title}</Text>
      <Text selectable style={styles.text}>{f.detail}</Text>
      <View style={styles.tabs}>
        {(["Arguments", "Output", ...(f.diff ? ["Diff"] : [])] as const).map(label => <Pressable key={label} accessibilityRole="button" onPress={() => setTab(label === "Diff" ? "Diff" : label === "Arguments" ? "Arguments" : "Output")}><Text style={styles.action}>{label}</Text></Pressable>)}
        {f.path ? <Pressable accessibilityRole="button" onPress={() => { void openFile(); }}><Text style={styles.action}>Open file</Text></Pressable> : null}
        <Pressable accessibilityRole="button" onPress={() => { void Clipboard.setStringAsync(text).then(() => setNotice("Copied"), () => setNotice("Copy failed")); }}><Text style={styles.action}>Copy {tab.toLowerCase()}</Text></Pressable>
      </View>
      {tool.truncated && !tool.detailLoaded ? <Pressable accessibilityRole="button" onPress={() => request?.(tool.id)}><Text style={styles.action}>Load retained output (up to 1 MiB)</Text></Pressable> : null}
      {tool.truncated ? <Text style={styles.text}>Output is capped by the source or retention budget.</Text> : null}
      <Text style={styles.text}>{notice}</Text>
      <FlatList data={rows} keyExtractor={(_, i) => String(i)} initialNumToRender={24} maxToRenderPerBatch={24} windowSize={5} renderItem={({ item }) => <Text selectable style={[styles.text, tab === "Diff" && { color: item.startsWith("+") ? colors.ok : item.startsWith("-") ? colors.danger : colors.textMuted }]}>{item || " "}</Text>} />
    </View>
  </Modal>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: "#08090b", padding: 16, paddingTop: 40 }, title: { ...type.small, color: colors.text, marginVertical: 12 }, text: { ...type.mono, color: colors.textMuted, fontSize: 11, lineHeight: 17 }, tabs: { flexDirection: "row", flexWrap: "wrap", gap: 14 }, action: { ...type.small, color: colors.gold, paddingVertical: 12 } });
