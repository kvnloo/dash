import { StyleSheet, Text, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";
import { PRESS_SCALE } from "../motion";
import { bridge } from "../net/bridge";
import { store } from "../store/app";
import { colors, controlMin, glass, radius, space, type } from "../theme";
import { GlassSurface } from "./GlassSurface";
import { PressScale } from "./PressScale";

const enter = FadeIn.duration(110).easing(Easing.out(Easing.cubic)).reduceMotion(ReduceMotion.System);
const exit = FadeOut.duration(110).easing(Easing.out(Easing.cubic)).reduceMotion(ReduceMotion.System);

/** One non-blocking connection banner. The bridge owns reconnects and the queued drafts. */
export function ConnectionPill() {
  const connection = store.use((s) => s.connection);
  if (connection.status === "online" || connection.status === "idle") return null;

  const connecting = connection.status === "connecting";
  const heading = connecting ? "Connecting to bridge" : "Bridge unreachable";
  const failure = connection.error?.trim();
  const detail = connecting
    ? "Waiting for the saved bridge to respond."
    : `${failure || "No response. Check Tailscale on your phone and computer."} · Queued drafts kept`;

  // A double tap on the same mounted banner must not restart an in-flight retry.
  // bridge.retry() synchronously changes the store to "connecting"; a later
  // "offline" render gives the next failed attempt its own retry action.
  let requested = false;
  const retry = () => {
    if (connecting || requested) return;
    requested = true;
    try {
      bridge.retry();
    } catch (error) {
      requested = false;
      throw error;
    }
  };

  return (
    <Animated.View testID="connection-banner" entering={enter} exiting={exit} style={styles.wrap}>
      <GlassSurface variant="raised" borderRadius={radius.md} contentStyle={styles.row}>
        <View
          testID="connection-banner-copy"
          accessible
          accessibilityRole="text"
          accessibilityLiveRegion={connecting ? "none" : "polite"}
          accessibilityLabel={`${heading}. ${detail}`}
          style={styles.copy}
        >
          <Text numberOfLines={1} style={[styles.heading, connecting && styles.connecting]}>{heading}</Text>
          <Text numberOfLines={2} style={styles.detail}>{detail}</Text>
        </View>
        <PressScale
          testID="connection-retry"
          accessibilityRole="button"
          accessibilityLabel={connecting ? "Connecting to bridge" : "Retry bridge connection"}
          accessibilityHint="Retries the saved bridge connection. Queued drafts stay on this phone."
          accessibilityState={{ disabled: connecting, busy: connecting }}
          disabled={connecting}
          onPress={retry}
          scaleTo={PRESS_SCALE.control}
          style={[styles.retry, connecting && styles.retryDisabled]}
        >
          <Text style={styles.retryText}>{connecting ? "Trying…" : "Retry"}</Text>
        </PressScale>
      </GlassSurface>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "center",
    width: "94%",
    maxWidth: 540,
    marginTop: space.xs,
    marginBottom: space.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingLeft: space.md,
    paddingRight: space.xs,
    paddingVertical: space.xs,
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  heading: { ...type.label, color: colors.warn },
  connecting: { color: colors.textMuted },
  detail: { ...type.small, fontSize: 12, lineHeight: 16, color: colors.textMuted },
  retry: {
    minHeight: controlMin,
    minWidth: controlMin,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: glass.hair2,
    backgroundColor: glass.fillChipOn,
    paddingHorizontal: space.md,
  },
  retryDisabled: { opacity: 0.55 },
  retryText: { ...type.small, color: colors.text },
});
