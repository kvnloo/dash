import { forwardRef, useImperativeHandle } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NavigationProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation";
import { actionable, approvals } from "../store/approvals";
import { createConversation, store } from "../store/app";
import { colors, fonts, type } from "../theme";
import { IconButton } from "./ScreenHeader";
import { GestureDetector } from "react-native-gesture-handler";
import { useBridgePullOptional, useBridgePullPan } from "./BridgePull";
export type AppNavHandle = { setProgress(progress: number): void };
export const AppNav = forwardRef<AppNavHandle, { navigation: NavigationProp<RootStackParamList>; tab: number; onTab?(next: number): void; progress?: unknown }>(function AppNav({ navigation, tab, onTab }, ref) {
  useImperativeHandle(ref, () => ({ setProgress() {} }), []);
  const pull = useBridgePullOptional();
  const pan = useBridgePullPan();
  const pending = approvals.use(s => s.items.filter(actionable).length);
  return <GestureDetector gesture={pan}><View>
    <View style={styles.header}><Text style={styles.brand}>Dash</Text><IconButton icon="chevron-down" label="Bridge details" onPress={() => pull?.toggle()} /><IconButton icon="edit-3" label="New chat" onPress={() => { createConversation(store.get().settings?.harness ?? "omp"); navigation.navigate("Chat"); }} /><IconButton icon="settings" label="Settings" onPress={() => navigation.navigate("Settings")} /></View>
    <View style={styles.tabs} accessibilityLabel="Primary mobile workspace">
      {["Bots", "Chats", "Orchestra"].map((label, i) => <Pressable key={label} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: i === tab }} onPress={() => onTab ? onTab(i) : navigation.navigate("Main", { tab: i })} style={styles.tab}>
        <Text style={[styles.label, i === tab && styles.active]}>{label}</Text>{i === tab ? <View style={styles.dot} /> : null}
      </Pressable>)}
      {pending > 0 ? <Pressable accessibilityRole="tab" accessibilityLabel={`Approvals, ${pending} pending`} onPress={() => navigation.navigate("Approvals")} style={styles.tab}><View style={styles.badgeRow}><Text style={styles.label}>Approvals</Text><Text style={styles.badge}>{pending}</Text></View></Pressable> : null}
    </View>
  </View></GestureDetector>;
});
const styles = StyleSheet.create({
 header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
 brand: { ...type.title, color: colors.text, flex: 1 }, tabs: { flexDirection: "row", paddingHorizontal: 12, height: 52 },
 tab: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 44 },
 label: { fontFamily: fonts.semibold, fontSize: 15, color: colors.textTertiary }, active: { color: colors.text },
 dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.gold, position: "absolute", bottom: 5 },
 badgeRow: { flexDirection: "row", alignItems: "center", gap: 4 }, badge: { ...type.cardTitle, color: colors.gold },
});
