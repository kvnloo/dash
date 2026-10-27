import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import Animated, { ReduceMotion, ZoomIn } from "react-native-reanimated";
import {
  quickScrollBadge,
  quickScrollLabel,
  quickScrollPosition,
  shouldRenderQuickScroll,
  type QuickScrollDirection,
  type QuickScrollSide,
} from "../lib/a11y-quick-scroll";
import { PRESS_SCALE } from "../motion";
import { colors, controlMin, glass, timing, type } from "../theme";
import { PressScale } from "./PressScale";

export interface QuickScrollButtonProps {
  direction: QuickScrollDirection;
  visible: boolean;
  /** Keyboard-aware offset supplied by the scroll model, not recalculated here. */
  offset: number;
  badge?: number;
  side: QuickScrollSide;
  onPress(): void;
}

/**
 * Standalone transcript overlay; Hermes mounts it after the quick-scroll model lands.
 * Enter with opacity + scale, but unmount immediately on hide to remove the hit area.
 * Reanimated honors the OS reduce-motion preference for entrance and press feedback.
 */
const enter = ZoomIn.duration(timing.state).reduceMotion(ReduceMotion.System);

export function QuickScrollButton({
  direction,
  visible,
  offset,
  badge,
  side,
  onPress,
}: QuickScrollButtonProps) {
  if (!shouldRenderQuickScroll(visible)) return null;
  const count = direction === "down" ? quickScrollBadge(badge) : null;

  return (
    <Animated.View
      testID="quick-scroll-anchor"
      pointerEvents="box-none"
      entering={enter}
      style={[styles.anchor, quickScrollPosition(direction, offset, side)]}
    >
      <PressScale
        testID="quick-scroll-button"
        accessible
        accessibilityRole="button"
        accessibilityLabel={quickScrollLabel(direction, badge)}
        onPress={onPress}
        scaleTo={PRESS_SCALE.control}
        style={styles.hit}
      >
        <View
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.circle}
        >
          <Feather name={direction === "down" ? "arrow-down" : "arrow-up"} size={20} color={colors.text} />
          {count !== null ? (
            <View pointerEvents="none" style={[styles.badge, side === "left" ? styles.badgeRight : styles.badgeLeft]}>
              <Text accessible={false} style={styles.badgeText}>{count}</Text>
            </View>
          ) : null}
        </View>
      </PressScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: "absolute",
    width: controlMin,
    height: controlMin,
    zIndex: 8,
  },
  hit: {
    width: controlMin,
    height: controlMin,
    alignItems: "center",
    justifyContent: "center",
  },
  circle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.fillRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hair2,
    borderTopColor: glass.highlight,
    shadowColor: "#000000",
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 4,
  },
  badge: {
    position: "absolute",
    top: -7,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 3,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hair2,
  },
  badgeLeft: { left: -5 },
  badgeRight: { right: -5 },
  badgeText: { ...type.mono, fontSize: 10, lineHeight: 12, color: colors.text, textAlign: "center" },
});
