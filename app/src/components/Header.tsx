import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, space, type } from "../theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

export function IconButton({
  icon,
  onPress,
  label,
  size = 22,
}: {
  icon: IconName;
  onPress(): void;
  label: string;
  size?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={size} color={colors.text} />
    </Pressable>
  );
}

export function Header({ left, center, right }: { left?: ReactNode; center?: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={styles.side}>{left}</View>
      <View style={styles.center}>{center}</View>
      <View style={[styles.side, styles.right]}>{right}</View>
    </View>
  );
}

export function HeaderTitle({ children }: { children: string }) {
  return (
    <Text style={styles.title} numberOfLines={1}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.lg,
  },
  side: { width: 72, flexDirection: "row", alignItems: "center" },
  right: { justifyContent: "flex-end" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, ...type.heading },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20 },
  pressed: { backgroundColor: colors.surfaceRaised },
});
