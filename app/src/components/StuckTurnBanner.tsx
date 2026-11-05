import { Pressable, StyleSheet, Text, View } from "react-native";
import { parseTurnDiagnosis, stuckTurnView, type TurnAction } from "../lib/stuck-turn-view";
import { colors, controlMin, fonts, glass, radius, space, type } from "../theme";

export interface StuckTurnBannerProps {
  /** Untrusted bridge response; malformed diagnoses never expose action buttons. */
  diagnosis: unknown;
  busyAction?: string;
  /** Caller is responsible for authorization and dispatch; no action is sent by this component. */
  onAction: (action: TurnAction) => void;
}

/** Static, unmounted-by-default status surface. No motion, including in reduced-motion mode. */
export function StuckTurnBanner({ diagnosis, busyAction, onAction }: StuckTurnBannerProps) {
  const parsed = parseTurnDiagnosis(diagnosis);
  if (!parsed) return null;
  const view = stuckTurnView(parsed, { busyAction });
  if (!view) return null;

  return (
    <View testID="stuck-turn-banner" style={styles.root}>
      <View
        accessible
        accessibilityRole={parsed.state === "stuck" ? "alert" : "text"}
        accessibilityLiveRegion={view.tone === "warning" ? "assertive" : "polite"}
        accessibilityLabel={`${view.title}. ${view.detail}`}
        style={styles.copy}
      >
        <Text accessible={false} style={[styles.title, view.tone === "warning" && styles.warning]}>
          {view.title}
        </Text>
        <Text accessible={false} style={styles.detail}>{view.detail}</Text>
      </View>
      {view.actions.length > 0 ? (
        <View style={styles.actions}>
          {view.actions.map((action) => (
            <Pressable
              key={action.id}
              testID={`stuck-turn-action-${action.id}`}
              accessibilityRole="button"
              accessibilityLabel={action.accessibilityLabel}
              accessibilityState={{ disabled: action.disabled, busy: busyAction === action.id }}
              disabled={action.disabled}
              onPress={() => { if (!action.disabled) onAction(action.id); }}
              style={({ pressed }) => [
                styles.action,
                action.id === "cancel" && styles.destructive,
                action.disabled && styles.disabled,
                pressed && !action.disabled && styles.pressed,
              ]}
            >
              <Text style={[styles.actionText, action.id === "cancel" && styles.destructiveText]}>
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: "stretch",
    maxWidth: "100%",
    marginTop: space.xs,
    padding: space.md,
    gap: space.sm,
    borderWidth: 1,
    borderColor: glass.hair,
    borderTopColor: glass.highlight,
    borderRadius: radius.md,
    backgroundColor: glass.fill,
  },
  copy: { gap: space.xs },
  title: { ...type.small, fontFamily: fonts.semibold, color: colors.text },
  warning: { color: colors.warn },
  detail: { ...type.small, color: colors.textMuted },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
  },
  action: {
    minHeight: controlMin,
    minWidth: controlMin,
    paddingHorizontal: space.lg,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: glass.hair2,
    borderRadius: radius.pill,
    backgroundColor: glass.fillRaised,
  },
  destructive: { borderColor: colors.danger },
  actionText: { ...type.small, fontFamily: fonts.semibold, color: colors.text },
  destructiveText: { color: colors.danger },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.8 },
});
