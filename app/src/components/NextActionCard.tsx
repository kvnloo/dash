import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  cardModel,
  dispatchCardAction,
  type NextAction,
  type NextActionCardButtonId,
  type NextActionCardHandlers,
} from "../lib/next-action-card";
import { colors, controlMin, glass, radius, space, type } from "../theme";

export interface NextActionCardProps extends NextActionCardHandlers {
  action: NextAction;
}

/**
 * Unmounted by design. Callers own navigation, permissions, dismissals, and one-hour snooze.
 * The only local state is whether this action's Why? explanation is expanded.
 */
export function NextActionCard({ action, onDo, onLater, onSkip, onEdit }: NextActionCardProps) {
  const [expandedForId, setExpandedForId] = useState<string | null>(null);
  const expandedWhy = expandedForId === action.id;
  const model = cardModel(action, { expandedWhy });

  const press = (id: NextActionCardButtonId) => {
    if (id === "why") {
      setExpandedForId((current) => current === action.id ? null : action.id);
      return;
    }
    dispatchCardAction(id, action, { onDo, onLater, onSkip, onEdit });
  };

  return (
    <View testID="next-action-card" style={styles.card}>
      <View style={styles.header}>
        <Text testID="next-action-title" numberOfLines={1} ellipsizeMode="tail" style={styles.title}>
          {model.title}
        </Text>
        <View
          accessible
          accessibilityRole="text"
          accessibilityLabel={"Estimated time " + model.timeChip}
          style={styles.timeChip}
        >
          <Text accessible={false} style={styles.timeText}>{model.timeChip}</Text>
        </View>
      </View>
      <Text numberOfLines={1} ellipsizeMode="tail" style={styles.detail}>{model.detail}</Text>
      <View style={styles.actions}>
        {model.buttons.map((button) => (
          <Pressable
            key={button.id}
            testID={"next-action-" + button.id}
            accessible
            accessibilityRole="button"
            accessibilityLabel={button.accessibilityLabel}
            accessibilityHint={button.accessibilityHint}
            accessibilityState={button.id === "why" ? { expanded: expandedWhy } : undefined}
            onPress={() => press(button.id)}
            style={({ pressed }) => [
              styles.button,
              button.id === "do" && styles.doButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.buttonText, button.id === "do" && styles.doText]}>{button.label}</Text>
          </Pressable>
        ))}
      </View>
      {model.whyText !== null ? (
        <Text testID="next-action-why" accessibilityRole="text" style={styles.whyText}>
          {model.whyText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: "stretch",
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    gap: space.xs,
    borderWidth: 1,
    borderColor: glass.hair,
    borderTopColor: glass.highlight,
    borderRadius: radius.md,
    backgroundColor: glass.fillRaised,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  title: {
    ...type.heading,
    flex: 1,
    flexShrink: 1,
    color: colors.text,
  },
  timeChip: {
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: glass.hair,
    backgroundColor: glass.fillChip,
  },
  timeText: { ...type.label, color: colors.textMuted },
  detail: { ...type.small, color: colors.textMuted },
  actions: { flexDirection: "row", gap: space.xs, alignItems: "stretch" },
  button: {
    flex: 1,
    minHeight: controlMin,
    minWidth: controlMin,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: glass.hair,
    backgroundColor: glass.fillChip,
  },
  doButton: { borderColor: glass.hair2, backgroundColor: glass.fillChipOn },
  pressed: { opacity: 0.7 },
  buttonText: { ...type.label, color: colors.textMuted },
  doText: { color: colors.text },
  whyText: {
    ...type.small,
    color: colors.textMuted,
    paddingHorizontal: space.xs,
    paddingBottom: space.xs,
  },
});
