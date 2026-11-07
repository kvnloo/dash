import { StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { PRESS_SCALE } from "../motion";
import { statusIn as enter, statusOut as exit } from "./motion-enter";
import { bridge } from "../net/bridge";
import { store } from "../store/app";
import { colors, controlMin, glass, radius, space, type } from "../theme";
import { connectionBannerFor, createConnectionRetry } from "./connection-banner";
import { GlassSurface } from "./GlassSurface";
import { PressScale } from "./PressScale";


/** One non-blocking connection banner. The bridge owns reconnects and the queued drafts. */
export function ConnectionPill() {
  const connection = store.use((s) => s.connection);
  const banner = connectionBannerFor(connection);
  if (!banner) return null;

  // bridge.retry() synchronously switches the store to "connecting". The
  // next offline render gives the next failed attempt a fresh retry guard.
  const retry = createConnectionRetry(banner.connecting, () => bridge.retry());

  return (
    <Animated.View testID="connection-banner" entering={enter} exiting={exit} style={styles.wrap}>
      <GlassSurface variant="raised" borderRadius={radius.md} contentStyle={styles.row}>
        <View
          testID="connection-banner-copy"
          accessible
          accessibilityRole="text"
          accessibilityLiveRegion={banner.liveRegion}
          accessibilityLabel={banner.heading + ". " + banner.detail}
          style={styles.copy}
        >
          <Text numberOfLines={1} style={[styles.heading, banner.connecting && styles.connecting]}>{banner.heading}</Text>
          <Text numberOfLines={2} style={styles.detail}>{banner.detail}</Text>
        </View>
        <PressScale
          testID="connection-retry"
          accessibilityRole="button"
          accessibilityLabel={banner.retryLabel}
          accessibilityHint="Retries the saved bridge connection. Queued drafts stay on this phone."
          accessibilityState={{ disabled: banner.connecting, busy: banner.connecting }}
          disabled={banner.connecting}
          onPress={retry}
          scaleTo={PRESS_SCALE.control}
          style={[styles.retry, banner.connecting && styles.retryDisabled]}
        >
          <Text style={styles.retryText}>{banner.retryText}</Text>
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
