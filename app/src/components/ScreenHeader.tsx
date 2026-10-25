import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { StyleSheet, Text, View } from "react-native";
import { PressScale } from "./PressScale";
import { haptic } from "../haptics";
import { headerButtonModel, invokeHeaderButton, type HeaderButtonState } from "../lib/a11y-screen-header";
import { colors, glass, type } from "../theme";

type IconButtonProps = {
  icon: ComponentProps<typeof Feather>["name"];
  label: string;
  onPress?: () => void;
  state?: HeaderButtonState;
};

export function IconButton({ icon, label, onPress, state }: IconButtonProps) {
  const model = headerButtonModel(label, typeof onPress === "function", state);
  return (
    <PressScale
      accessible
      accessibilityRole="button"
      accessibilityLabel={model.label}
      accessibilityState={model.accessibilityState}
      disabled={model.disabled}
      onPress={() => { invokeHeaderButton(model, onPress, () => haptic.select()); }}
      style={[styles.hit, model.disabled && styles.disabled]}
    >
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.circle, model.accessibilityState.selected && styles.selected]}
      >
        <Feather name={icon} size={18} color={colors.textMuted} />
      </View>
    </PressScale>
  );
}

type ScreenHeaderProps = {
  title: string;
  onBack(): void;
  onAction?(): void;
  action?: string;
  icon?: ComponentProps<typeof Feather>["name"];
  compact?: boolean;
  backState?: HeaderButtonState;
  actionState?: HeaderButtonState;
};

export function ScreenHeader({
  title,
  onBack,
  onAction,
  action = "Settings",
  icon = "settings",
  compact = false,
  backState,
  actionState,
}: ScreenHeaderProps) {
  const hasTitle = title.trim().length > 0;
  const actionLabel = action.trim();
  const hasAction = typeof onAction === "function" && actionLabel.length > 0;
  return (
    <View style={styles.row}>
      <IconButton icon="arrow-left" label="Back" onPress={onBack} state={backState} />
      <Text
        accessible={hasTitle}
        accessibilityRole="header"
        accessibilityLabel={hasTitle ? title : undefined}
        allowFontScaling
        numberOfLines={1}
        style={[styles.title, !compact && type.title]}
      >
        {title}
      </Text>
      {hasAction
        ? <IconButton icon={icon} label={actionLabel} onPress={onAction} state={actionState} />
        : <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.hit} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, height: 60, gap: 8 },
  title: { ...type.cardTitle, flex: 1, color: colors.text },
  hit: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.42 },
  circle: { width: 36, height: 36, borderRadius: 18, backgroundColor: glass.fill, borderWidth: 1, borderColor: glass.hair, borderTopColor: glass.highlight, alignItems: "center", justifyContent: "center" },
  selected: { borderColor: colors.gold, borderTopColor: colors.gold },
});
