import { useEffect, useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { authorizedBridgeFetch } from "../lib/bridge-request-auth";
import type { LinkTarget } from "../lib/link-target";
import { store } from "../store/app";
import { colors, radius, space, type } from "../theme";

export type FileLinkTarget = Extract<LinkTarget, { kind: "file" }>;
type Preview = { status: "loading" | "ready" | "error"; content: string };
const ROW_HEIGHT = 22;

/** Preview a classified source link on the paired host without leaving Dash. */
export function FileLinkPreview({ target, onClose }: { target: FileLinkTarget; onClose(): void }) {
  const settings = store.use(s => s.settings);
  const insets = useSafeAreaInsets();
  const [preview, setPreview] = useState<Preview>({ status: "loading", content: "" });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    setPreview({ status: "loading", content: "" });
    const load = async () => {
      if (!settings) {
        if (active) setPreview({ status: "error", content: "Pair with a bridge to preview files." });
        return;
      }
      try {
        // Same authenticated text-preview endpoint used by ToolInspector.
        const url = "http://" + settings.address + "/files?format=text&path=" + encodeURIComponent(target.path);
        const result = await authorizedBridgeFetch(settings, url, { signal: controller.signal });
        if (!active) return;
        if (!result.ok) {
          setPreview({ status: "error", content: "File unavailable (bridge authorization failed)." });
        } else if (!result.response.ok) {
          setPreview({ status: "error", content: "File unavailable (HTTP " + result.response.status + ")." });
        } else {
          const content = await result.response.text();
          if (active) setPreview({ status: "ready", content });
        }
      } catch {
        if (active) setPreview({ status: "error", content: "File unavailable." });
      }
    };
    void load();
    return () => { active = false; controller.abort(); clearTimeout(timeout); };
  }, [settings, target.path]);

  // Source files can be large; render only visible rows, at the requested line.
  const lines = useMemo(() => preview.status === "ready" ? preview.content.split("\n") : [], [preview]);
  const selected = (target.line ?? 1) - 1;
  const first = Math.min(Math.max(0, selected - 3), Math.max(0, lines.length - 1));

  return <Modal visible animationType="none" statusBarTranslucent onRequestClose={onClose}>
    <View testID="file-link-preview" style={[styles.root, {
      paddingTop: Math.max(insets.top, space.xl),
      paddingBottom: Math.max(insets.bottom, space.md),
    }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close file preview" onPress={onClose} style={styles.close}>
        <Text style={styles.closeLabel}>Close file preview</Text>
      </Pressable>
      <Text selectable style={styles.location}>
        {target.path}{target.line === undefined ? "" : " · line " + target.line}{target.column === undefined ? "" : ":" + target.column}
      </Text>
      {preview.status === "ready" ? <FlatList
        style={styles.list}
        data={lines}
        initialScrollIndex={first}
        getItemLayout={(_data, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        keyExtractor={(_row, index) => String(index)}
        initialNumToRender={26}
        maxToRenderPerBatch={26}
        renderItem={({ item, index }) => <View style={[styles.line, index === selected && styles.selectedLine]}>
          <Text style={styles.number}>{index + 1}</Text>
          <Text selectable numberOfLines={1} style={[styles.code, index === selected && styles.selectedCode]}>{item || " "}</Text>
        </View>}
      /> : <Text style={styles.message}>{preview.status === "loading" ? "Loading file…" : preview.content}</Text>}
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: space.lg },
  close: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: space.sm },
  closeLabel: { ...type.small, color: colors.gold },
  location: { ...type.mono, color: colors.text, marginVertical: space.md },
  list: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.sm },
  line: { height: ROW_HEIGHT, paddingHorizontal: space.sm, flexDirection: "row", alignItems: "center" },
  number: { ...type.mono, fontSize: 12, color: colors.textMuted, width: 48 },
  code: { ...type.mono, fontSize: 12, color: colors.text, flex: 1 },
  selectedLine: { backgroundColor: colors.surfaceRaised },
  selectedCode: { color: colors.gold },
  message: { ...type.body, color: colors.textMuted },
});
