import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { StyleSheet, Text, View } from "react-native";
import { PressScale } from "./PressScale";
import { haptic } from "../haptics";
import { colors, glass, type } from "../theme";
export function IconButton({ icon, label, onPress }: { icon: ComponentProps<typeof Feather>["name"]; label: string; onPress(): void }) {
  return <PressScale accessibilityRole="button" accessibilityLabel={label} onPress={() => { haptic.select(); onPress(); }} style={styles.hit}>
    <View style={styles.circle}><Feather name={icon} size={18} color={colors.textMuted} /></View>
  </PressScale>;
}
export function ScreenHeader({ title, onBack, onAction, action = "Settings", icon = "settings", compact = false }: { title: string; onBack(): void; onAction?(): void; action?: string; icon?: ComponentProps<typeof Feather>["name"]; compact?: boolean }) {
  return <View style={styles.row}><IconButton icon="arrow-left" label="Back" onPress={onBack} /><Text numberOfLines={1} style={[styles.title, !compact && type.title]}>{title}</Text>{onAction ? <IconButton icon={icon} label={action} onPress={onAction} /> : <View style={styles.hit} />}</View>;
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, height: 60, gap: 8 },
  title: { ...type.cardTitle, flex: 1, color: colors.text },
  hit: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  circle: { width: 36, height: 36, borderRadius: 18, backgroundColor: glass.fill, borderWidth: 1, borderColor: glass.hair, borderTopColor: glass.highlight, alignItems: "center", justifyContent: "center" },
});
