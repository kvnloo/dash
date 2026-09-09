import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { haptic } from "../haptics";
import { colors, radius, space, type } from "../theme";

export const MAIN_TABS = ["Bots", "Chats", "Orchestra"] as const;
export type MainTab = (typeof MAIN_TABS)[number];

export const TopTabs = memo(function TopTabs({
  index,
  onChange,
}: {
  index: number;
  onChange(next: number): void;
}) {
  return (
    <View style={styles.track}>
      {MAIN_TABS.map((label, i) => {
        const active = i === index;
        return (
          <Pressable
            key={label}
            onPress={() => {
              if (i !== index) {
                haptic.select();
                onChange(i);
              }
            }}
            style={[styles.tab, active && styles.tabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    padding: 3,
    gap: 2,
    maxWidth: 280,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 7,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
  },
  tabActive: { backgroundColor: colors.surfaceRaised },
  label: { color: colors.textMuted, ...type.small, textTransform: "none", letterSpacing: 0, fontWeight: "600" },
  labelActive: { color: colors.text },
});
