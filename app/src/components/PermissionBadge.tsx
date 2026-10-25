import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text } from "react-native";
import {
  PERMISSION_BADGE_MIN_HIT,
  formatPermissionCount,
  permissionCountReviewLabel,
} from "../lib/permission-badge";
import { colors, glass, radius, space, type } from "../theme";

export interface PermissionBadgeProps {
  /** Pending, conversation-scoped permission requests; supplied by the parent. */
  count: number;
  /** Open the pending request review surface. The parent owns navigation. */
  onPress(): void;
}

/**
 * Standalone Needs OK control for a toolbar row (not the camera cut-out pill).
 * No subscription, polling or animation: Hermes supplies the count and mounts it
 * beside the existing mode, connection and work-status controls.
 */
export function PermissionBadge({ count, onPress }: PermissionBadgeProps) {
  const visibleLabel = formatPermissionCount(count);
  const accessibilityLabel = permissionCountReviewLabel(count);
  if (visibleLabel === null || accessibilityLabel === null) return null;

  return (
    <Pressable
      testID="permission-badge"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens pending permission requests for review"
      onPress={onPress}
      style={({ pressed }) => [styles.badge, pressed && styles.pressed]}
    >
      <Feather name="alert-circle" size={14} color={colors.warn} />
      <Text
        testID="permission-badge-count"
        style={styles.label}
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
      >
        {visibleLabel}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    minHeight: PERMISSION_BADGE_MIN_HIT,
    minWidth: PERMISSION_BADGE_MIN_HIT,
    maxWidth: 164,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.xs,
    alignSelf: "center",
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: glass.fillChip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hair2,
  },
  pressed: { backgroundColor: glass.fillChipOn },
  label: { ...type.label, color: colors.text, flexShrink: 1 },
});
