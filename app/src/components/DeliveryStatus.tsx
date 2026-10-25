import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { canRequestDeliveryRetry, describeDeliveryStatus, type DeliveryStage } from "../lib/delivery-status";
import { colors, controlMin, fonts, glass, radius, space, type } from "../theme";

export interface DeliveryStatusProps {
  stage: DeliveryStage;
  retryNeeded: boolean;
  retryBusy: boolean;
  note?: string | null;
  /** Must retry the persisted clientId/turnId/payload; never create another turn here. */
  onRetry: () => void;
}

/** Standalone status for a user bubble. Hermes mounts it after durable outbox wiring. */
export function DeliveryStatus({ stage, retryNeeded, retryBusy, note, onRetry }: DeliveryStatusProps) {
  const [requested, setRequested] = useState(false);
  const requestLatched = useRef(false);
  const previousBusy = useRef(retryBusy);

  // Allow a new attempt only after the caller completes a busy cycle or a receipt clears retry.
  useEffect(() => {
    if (!retryNeeded || stage === "received" || stage === "started" || (previousBusy.current && !retryBusy)) {
      requestLatched.current = false;
      setRequested(false);
    }
    previousBusy.current = retryBusy;
  }, [retryNeeded, retryBusy, stage]);

  const status = describeDeliveryStatus({ stage, retryNeeded, retryBusy: retryBusy || requested, note });

  const retry = () => {
    if (!canRequestDeliveryRetry(status, requestLatched.current)) return;
    requestLatched.current = true; // Prevent two taps before React applies a state update.
    setRequested(true);
    try {
      onRetry();
    } catch (error) {
      requestLatched.current = false;
      setRequested(false);
      throw error;
    }
  };

  return (
    <View testID="delivery-status" style={styles.root}>
      <View
        accessible
        accessibilityRole="text"
        accessibilityLiveRegion={status.retryVisible ? "assertive" : "polite"}
        accessibilityLabel={status.accessibilityLabel}
        style={styles.copy}
      >
        <Text
          accessible={false}
          style={[styles.label, status.tone === "warning" && styles.warning, status.tone === "confirmed" && styles.confirmed]}
        >
          {status.label}
        </Text>
        <Text accessible={false} style={styles.helper}>{status.helper}</Text>
        {status.note ? <Text accessible={false} style={styles.note}>{status.note}</Text> : null}
      </View>
      {status.retryVisible ? (
        <Pressable
          testID="delivery-retry"
          accessibilityRole="button"
          accessibilityLabel={status.retryBusy ? "Retrying message delivery" : "Retry message delivery"}
          accessibilityHint="Delivery is unconfirmed. Retry must use the same message identifiers."
          accessibilityState={{ disabled: status.retryDisabled, busy: status.retryBusy }}
          disabled={status.retryDisabled}
          onPress={retry}
          style={({ pressed }) => [
            styles.retry,
            status.retryDisabled && styles.retryDisabled,
            pressed && !status.retryDisabled && styles.retryPressed,
          ]}
        >
          <Text style={styles.retryText}>{status.retryBusy ? "Retrying…" : "Retry"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: "stretch",
    maxWidth: "100%",
    marginTop: space.xs,
    padding: space.sm,
    gap: space.sm,
    borderWidth: 1,
    borderColor: glass.hair,
    borderTopColor: glass.highlight,
    borderRadius: radius.md,
    backgroundColor: glass.fill,
  },
  copy: { gap: space.xs },
  label: { ...type.small, fontFamily: fonts.semibold, color: colors.textMuted },
  warning: { color: colors.warn },
  confirmed: { color: colors.ok },
  helper: { ...type.small, color: colors.textMuted },
  note: { ...type.small, color: colors.textTertiary },
  retry: {
    minHeight: controlMin,
    minWidth: controlMin,
    alignSelf: "flex-start",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: glass.hair2,
    backgroundColor: glass.fillRaised,
  },
  retryText: { ...type.small, fontFamily: fonts.semibold, color: colors.text },
  retryDisabled: { opacity: 0.55 },
  retryPressed: { opacity: 0.8 },
});
