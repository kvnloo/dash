import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { haptic } from "../haptics";
import { colors, space } from "../theme";

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
              haptic.select();
              onChange(i);
            }}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
              {label}
            </Text>
            {active ? <View style={styles.indicator} /> : <View style={styles.indicatorSpacer} />}
          </Pressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: space.lg,
    maxWidth: 300,
  },
  tab: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 4,
    paddingBottom: 2,
    minWidth: 72,
  },
  label: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  labelActive: { color: colors.text },
  indicator: {
    marginTop: 6,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.text,
  },
  indicatorSpacer: { marginTop: 6, height: 5 },
});
