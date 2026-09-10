import { useNavigation, type NavigationProp } from "@react-navigation/native";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  ReduceMotion,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic } from "../haptics";
import { GEL, PRESS_SCALE } from "../motion";
import type { Connection } from "../model";
import type { RootStackParamList } from "../navigation";
import { bridge } from "../net/bridge";
import { store } from "../store/app";
import { colors, radius, space, type } from "../theme";
import {
  backdropOpacity,
  pullFromDrag,
  settlePull,
  sheetStretchY,
  sheetTranslateY,
} from "./bridge-pull";
import { GlassSurface } from "./GlassSurface";
import { NAV_CHROME_HEIGHT, NAV_PAGER_RADIUS } from "./golden-nav";
import { PressScale } from "./PressScale";

const gel = { ...GEL, reduceMotion: ReduceMotion.System };

export type BridgePullApi = {
  progress: SharedValue<number>;
  height: SharedValue<number>;
  open(): void;
  close(): void;
  toggle(): void;
};

const BridgePullContext = createContext<BridgePullApi | null>(null);

export function useBridgePull(): BridgePullApi {
  const api = useContext(BridgePullContext);
  if (!api) throw new Error("BridgePullProvider is required");
  return api;
}

export function useBridgePullOptional(): BridgePullApi | null {
  return useContext(BridgePullContext);
}

function snapTo(progress: SharedValue<number>, next: 0 | 1) {
  "worklet";
  progress.value = withSpring(next, gel);
}

export function useBridgePullPan() {
  const api = useBridgePullOptional();
  const start = useSharedValue(0);
  return Gesture.Pan()
    .enabled(api != null)
    .maxPointers(1)
    .activeOffsetY([-22, 10])
    .failOffsetX([-24, 24])
    .onBegin(() => {
      if (!api) return;
      const p = api.progress.value;
      start.value = p > 1 ? 1 : p < 0 ? 0 : p;
    })
    .onUpdate((e) => {
      if (!api) return;
      if (start.value < 0.02 && e.translationY < 0) return;
      api.progress.value = pullFromDrag(start.value, e.translationY, api.height.value);
    })
    .onEnd((e) => {
      if (!api) return;
      const next = settlePull(api.progress.value, e.velocityY, api.height.value);
      snapTo(api.progress, next);
      runOnJS(haptic.select)();
    });
}

let debugHandle: { open(): void; close(): void } | null = null;

export function debugSetBridgePull(open: boolean): void {
  if (open) debugHandle?.open();
  else debugHandle?.close();
}

export function BridgePullProvider({ children }: { children: ReactNode }) {
  const progress = useSharedValue(0);
  const height = useSharedValue(280);

  const open = useCallback(() => {
    progress.value = withSpring(1, gel);
  }, [progress]);
  const close = useCallback(() => {
    progress.value = withSpring(0, gel);
  }, [progress]);
  const toggle = useCallback(() => {
    progress.value = withSpring(progress.value >= 0.5 ? 0 : 1, gel);
  }, [progress]);

  const api = useMemo<BridgePullApi>(
    () => ({ progress, height, open, close, toggle }),
    [progress, height, open, close, toggle],
  );

  debugHandle = { open, close };

  return <BridgePullContext.Provider value={api}>{children}</BridgePullContext.Provider>;
}

function statusLine(connection: Connection): { color: string; text: string } {
  switch (connection.status) {
    case "online":
      return { color: colors.ok, text: connection.host ?? "Connected" };
    case "connecting":
      return { color: colors.warn, text: "Connecting…" };
    case "offline":
      return { color: colors.danger, text: connection.error ?? "Offline" };
    case "idle":
      return { color: colors.textFaint, text: "Not connected" };
    default: {
      const _exhaustive: never = connection.status;
      return _exhaustive;
    }
  }
}

export function BridgePullOverlay() {
  const api = useBridgePull();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const connection = store.use((s) => s.connection);
  const settings = store.use((s) => s.settings);
  const sheetPan = useBridgePullPan();
  const hitPan = useBridgePullPan();
  const [armed, setArmed] = useState(false);

  useAnimatedReaction(
    () => api.progress.value > 0.04,
    (next, prev) => {
      if (next !== prev) runOnJS(setArmed)(next);
    },
  );

  const sheetStyle = useAnimatedStyle(() => {
    const p = api.progress.value;
    const h = api.height.value;
    return {
      transform: [{ translateY: sheetTranslateY(p, h) }, { scaleY: sheetStretchY(p) }],
      transformOrigin: "top",
      opacity: p <= 0.02 ? 0 : 1,
    };
  });
  const dimStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity(api.progress.value),
  }));

  const status = statusLine(connection);
  const canRetry = connection.status === "offline" || connection.status === "connecting";
  const hosts = connection.hosts;
  const harnesses = connection.harnesses;
  const top = insets.top + NAV_CHROME_HEIGHT;

  const goEdit = () => {
    api.close();
    haptic.tap();
    navigation.navigate(settings ? "Settings" : "Pair");
  };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View pointerEvents={armed ? "auto" : "none"} style={[styles.dim, { top }, dimStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            haptic.tap();
            api.close();
          }}
          accessibilityRole="button"
          accessibilityLabel="Dismiss bridge details"
        />
      </Animated.View>
      <GestureDetector gesture={hitPan}>
        <View
          pointerEvents={armed ? "none" : "auto"}
          collapsable={false}
          style={[styles.hit, { top }]}
          accessibilityElementsHidden
        />
      </GestureDetector>
      <GestureDetector gesture={sheetPan}>
        <Animated.View
          pointerEvents={armed ? "auto" : "none"}
          style={[styles.sheetWrap, { top: top - 2 }, sheetStyle]}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 1) api.height.value = h;
          }}
        >
          <GlassSurface
            variant="nav"
            borderRadius={NAV_PAGER_RADIUS}
            style={styles.sheet}
            contentStyle={styles.sheetInner}
            accessibilityLabel="Bridge details"
          >
            <PressScale
              scaleTo={PRESS_SCALE.row}
              onPress={() => {
                if (canRetry) {
                  haptic.tap();
                  bridge.retry();
                }
              }}
              disabled={!canRetry}
              accessibilityRole="button"
              accessibilityLabel={status.text}
              style={styles.statusRow}
            >
              <View style={[styles.dot, { backgroundColor: status.color }]} />
              <View style={styles.statusText}>
                <Text style={styles.title} numberOfLines={1}>
                  {status.text}
                </Text>
                {settings?.address ? (
                  <Text style={styles.meta} numberOfLines={1}>
                    {settings.address}
                    {connection.cwd ? ` · ${connection.cwd}` : settings.cwd ? ` · ${settings.cwd}` : ""}
                  </Text>
                ) : (
                  <Text style={styles.meta} numberOfLines={1}>
                    Pull down anytime · edit to pair
                  </Text>
                )}
              </View>
            </PressScale>

            {hosts.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.label}>Hosts</Text>
                {hosts.map((h) => (
                  <View key={h.id} style={styles.row}>
                    <View style={[styles.dotSm, { backgroundColor: h.online ? colors.ok : colors.textFaint }]} />
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {h.name}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {h.self ? "this laptop" : h.address ?? h.hostname}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {harnesses.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.label}>Harnesses</Text>
                <View style={styles.chips}>
                  {harnesses.map((h) => (
                    <View key={h.id} style={styles.chip}>
                      <View
                        style={[styles.dotSm, { backgroundColor: h.available ? colors.ok : colors.textFaint }]}
                      />
                      <Text style={styles.chipText}>{h.name}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            <PressScale
              scaleTo={PRESS_SCALE.control}
              onPress={goEdit}
              accessibilityRole="button"
              accessibilityLabel={settings ? "Edit bridge" : "Pair"}
              style={styles.edit}
            >
              <Text style={styles.editText}>{settings ? "Edit" : "Pair"}</Text>
            </PressScale>
            <View style={styles.handle} />
          </GlassSurface>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#000",
  },
  hit: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 24,
  },
  sheetWrap: {
    position: "absolute",
    left: space.lg,
    right: space.lg,
  },
  sheet: {
    overflow: "hidden",
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  sheetInner: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
    gap: space.sm,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: 4,
  },
  statusText: { flex: 1, minWidth: 0 },
  title: { color: colors.ink, ...type.heading },
  meta: { color: colors.ink3, ...type.small, marginTop: 2 },
  label: { color: colors.ink3, ...type.label, marginBottom: 6 },
  section: { gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 22 },
  rowTitle: { color: colors.ink, ...type.small, flexShrink: 1 },
  rowMeta: { color: colors.ink3, ...type.small, marginLeft: "auto", maxWidth: "46%" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: "rgba(18,18,18,0.45)",
  },
  chipText: { color: colors.ink2, ...type.small },
  edit: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: "rgba(230,205,150,0.14)",
  },
  editText: { color: colors.gold, ...type.small, fontWeight: "600" },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(236,232,223,0.22)",
    marginTop: 4,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotSm: { width: 6, height: 6, borderRadius: 3 },
});
