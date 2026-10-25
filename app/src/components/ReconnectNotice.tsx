import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { PRESS_SCALE } from "../motion";
import { reconnectPresentation, type ReconnectSnapshot } from "../lib/reconnect-lifecycle";
import { colors, radius, space, type } from "../theme";
import { GlassSurface } from "./GlassSurface";
import { PressScale } from "./PressScale";

export interface ReconnectNoticeProps {
  state: ReconnectSnapshot;
  onRetry(): void;
  onPair(): void;
}

/** No entrance animations: readable with reduced motion and TalkBack. */
export function ReconnectNotice({ state, onRetry, onPair }: ReconnectNoticeProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.phase !== "waiting") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.phase, state.nextAttemptAt]);

  const presentation = reconnectPresentation(state, now);
  if (!presentation) return null;

  return (
    <View style={styles.wrap} testID="pc-reconnect-notice">
      <PressScale
        testID="pc-reconnect-action"
        style={styles.hit}
        scaleTo={PRESS_SCALE.control}
        accessibilityRole="button"
        accessibilityLabel={presentation.accessibilityLabel}
        accessibilityHint={presentation.action === "pair" ? "Opens pairing settings" : "Tries connecting to the PC immediately"}
        onPress={presentation.action === "pair" ? onPair : onRetry}
      >
        <GlassSurface borderRadius={radius.pill} style={styles.glass}>
          <Text style={styles.status} accessibilityLiveRegion="polite" numberOfLines={2}>
            {presentation.text}
          </Text>
          <Text style={styles.action}>{presentation.actionLabel}</Text>
        </GlassSurface>
      </PressScale>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "center", marginTop: space.xs, marginBottom: space.sm, maxWidth: "95%" },
  hit: { minHeight: 44, justifyContent: "center" },
  glass: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
  },
  status: { ...type.small, color: colors.textMuted, flexShrink: 1 },
  action: { ...type.small, color: colors.text, fontWeight: "600" },
});
