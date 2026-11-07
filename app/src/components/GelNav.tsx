import { useHandedness } from "../lib/useHandedness";
import { Feather } from "@expo/vector-icons";
import { forwardRef, memo, useEffect, useImperativeHandle, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import type { NavigationProp } from "@react-navigation/native";
import { haptic } from "../haptics";
import { PRESS_SCALE } from "../motion";
import type { RootStackParamList } from "../navigation";
import { useBridgePullOptional, useBridgePullPan } from "./BridgePull";
import { PressScale } from "./PressScale";
import { colors, fonts, glass, proofMono } from "../theme";
import {
  GOLD_68,
  GOLD_RIM,
  NAV_CHROME_HEIGHT,
  NAV_PAGER_HEIGHT,
  NAV_PAGER_PAD,
  NAV_PAGER_RADIUS,
  NAV_PAGER_WIDTH,
  NAV_PILL_HEIGHT,
  NAV_PILL_RADIUS,
  NAV_SLOT_WIDTH,
  NAV_DOT_SIZE,
  NAV_DOT_TOP,
  NAV_DOT_LEFT,
  TAB_LABELS,
  clampProgress,
  clampSettled,
  clampTab,
  indicatorTranslateX,
} from "./golden-nav";
import { toMain } from "../lib/main-nav";
import { annotate } from "../store/annotate";

const RIPPLE = { color: "transparent" as const };

export type AppNavHandle = {
  /** Drive the gold pill with pager position. UI-thread shared value; no React render. */
  setProgress(progress: number): void;
};

/**
 * The top navigation bar: Expand (Voice) · three-dot pager with the gold gel pill · Bridge details.
 * One Reanimated renderer for native and web, not a WebView.
 * The pill tracks a shared value written on the UI thread by the pager.
 * Living Night chrome: glass fill, rim highlight, cream hair, inset spec/shade on the gold.
 * The gold pill follows the pager 1:1, with no second animation.
 */
export const AppNav = memo(
  forwardRef<
    AppNavHandle,
    {
      navigation: NavigationProp<RootStackParamList>;
      tab: number;
      onTab?(next: number): void;
      progress?: SharedValue<number>;
    }
  >(function AppNav({ navigation, tab, onTab, progress: progressProp }, ref) {
    const thumb = useHandedness();
    const annotationActive = annotate.use(s => s.active);
    const internal = useSharedValue(clampProgress(tab));
    // A single source of truth: no second spring between the finger and indicator.
    const progress = progressProp ?? internal;

    useImperativeHandle(
      ref,
      () => ({
        setProgress(next: number) {
          progress.value = clampProgress(next);
        },
      }),
      [progress],
    );

    useEffect(() => {
      if (!progressProp) internal.value = clampSettled(tab);
    }, [internal, progressProp, tab]);

    const pillStyle = useAnimatedStyle(() => {
      const p = progress.value;
      const n = p;
      const scaleX = 1, scaleY = 1;
      const slot = NAV_SLOT_WIDTH;
      return {
        transform: [
          { translateX: n * slot },
          { translateX: slot / 2 },
          { scaleX },
          { scaleY },
          { translateX: -slot / 2 },
        ],
      };
    });
    void indicatorTranslateX;

    const goTab = (next: number) => {
      haptic.tap();
      if (onTab) onTab(next);
      else toMain(navigation, next);
    };

    const active = clampTab(tab);
    const pull = useBridgePullOptional();
    const pullPan = useBridgePullPan();
    const chevronStyle = useAnimatedStyle(() => {
      const p = pull ? pull.progress.value : 0;
      const n = p < 0 ? 0 : p > 1 ? 1 : p;
      return { transform: [{ rotateZ: `${n * 180}deg` }] };
    });

    const drag = (child: ReactNode) => (Platform.OS === "web" ? child : <GestureDetector gesture={pullPan}>{child}</GestureDetector>);

    return drag(
      <View style={styles.wrap} pointerEvents="box-none" collapsable={false}>
        <View style={[styles.row, thumb.row]}>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel="Expand"
            android_ripple={RIPPLE}
            scaleTo={PRESS_SCALE.nav}
            onPress={() => {
              haptic.tap();
              navigation.navigate("Voice");
            }}
            style={styles.circle}
          >
            <View style={styles.circleFace}>
              <Feather name="maximize-2" size={17} color={colors.textMuted} />
              <View pointerEvents="none" style={styles.circleHair} />
            </View>
          </PressScale>
          <View style={styles.pager} accessibilityLabel="Primary mobile workspace">
            <Animated.View pointerEvents="none" style={[styles.pillTrack, pillStyle]}>
              <View style={styles.pill}>
                <View style={styles.spec} />
                <View style={styles.shade} />
              </View>
            </Animated.View>
            <View style={styles.tabs}>
              {TAB_LABELS.map((label, i) => (
                <Pressable
                  key={label}
                  accessibilityRole="tab"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: i === active }}
                  aria-selected={i === active}
                  android_ripple={RIPPLE}
                  onPress={() => goTab(i)}
                  style={styles.tab}
                >
                  <View
                    pointerEvents="none"
                    style={[styles.dot, i === active ? styles.dotOn : styles.dotOff]}
                  />
                </Pressable>
              ))}
            </View>
            <View pointerEvents="none" style={styles.hair} />
          </View>
          <PressScale
            testID="spen-mode-pill"
            accessibilityRole="button"
            accessibilityLabel={`S Pen mode: ${annotationActive ? "Annotate" : "Normal"}. Switch to ${annotationActive ? "Normal" : "Annotate"}`}
            accessibilityState={{ selected: annotationActive }}
            android_ripple={RIPPLE}
            scaleTo={PRESS_SCALE.nav}
            onPress={() => {
              haptic.tap();
              // Switching modes keeps unsent ink; Discard in the tray is explicit.
              annotate.set(s => ({ ...s, active: !s.active, penMode: true }));
            }}
            style={styles.modePill}
          >
            <Text testID="spen-mode-label" allowFontScaling={false} numberOfLines={1} style={styles.modeText}>
              {annotationActive ? "Annotate" : "Normal"}
            </Text>
          </PressScale>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel="Bridge details"
            android_ripple={RIPPLE}
            scaleTo={PRESS_SCALE.nav}
            onPress={() => {
              haptic.tap();
              if (pull) pull.toggle();
              else navigation.navigate("Settings");
            }}
            style={styles.circle}
          >
            <View style={styles.circleFace}>
              <Animated.View style={chevronStyle}>
                <Feather name="chevron-down" size={18} color={colors.textMuted} />
              </Animated.View>
              <View pointerEvents="none" style={styles.circleHair} />
            </View>
          </PressScale>
        </View>
      </View>,
    );
  }),
);

const styles = StyleSheet.create({
  wrap: { height: NAV_CHROME_HEIGHT, backgroundColor: "transparent", overflow: "visible" },
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 8,
    overflow: "visible",
  },
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.fillNavStrong,
    overflow: "visible",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 8 },
  },
  modePill: {
    width: 88,
    height: 44,
    borderRadius: 22,
    backgroundColor: glass.fillNavStrong,
    borderWidth: 1,
    borderColor: glass.hair2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 8 },
  },
  modeText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0,
    textAlign: "center",
    includeFontPadding: false,
    flexShrink: 0,
    color: colors.text,
  },
  // A fixed face: PressScale lays children out in a centred inner view that would otherwise
  // shrink to the icon's width.
  circleFace: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  circleHair: {
    ...StyleSheet.absoluteFill,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: glass.hair2,
    borderTopColor: glass.highlight,
  },
  pager: {
    width: NAV_PAGER_WIDTH,
    height: NAV_PAGER_HEIGHT,
    borderRadius: NAV_PAGER_RADIUS,
    backgroundColor: glass.fillNavStrong,
    overflow: "visible",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 9 },
  },
  hair: {
    ...StyleSheet.absoluteFill,
    borderRadius: NAV_PAGER_RADIUS,
    borderWidth: 1,
    borderColor: glass.hair2,
    borderTopColor: glass.highlight,
  },
  pillTrack: {
    position: "absolute",
    top: NAV_PAGER_PAD,
    left: NAV_PAGER_PAD,
    width: NAV_SLOT_WIDTH,
    height: NAV_PILL_HEIGHT,
    overflow: "visible",
  },
  pill: {
    flex: 1,
    borderRadius: NAV_PILL_RADIUS,
    backgroundColor: proofMono ? "rgba(240, 240, 237, 0.62)" : GOLD_68,
    borderWidth: 1,
    borderColor: proofMono ? "#ffffff" : GOLD_RIM,
    overflow: "hidden",
  },
  spec: {
    position: "absolute",
    top: 0,
    left: 1,
    right: 1,
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.54)",
  },
  shade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 8,
    backgroundColor: "rgba(111, 85, 36, 0.25)",
  },
  tabs: {
    position: "absolute",
    top: NAV_PAGER_PAD,
    left: NAV_PAGER_PAD,
    width: NAV_SLOT_WIDTH * 3,
    height: NAV_PILL_HEIGHT,
    flexDirection: "row",
    zIndex: 1,
  },
  tab: {
    width: NAV_SLOT_WIDTH,
    height: NAV_PILL_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
    top: NAV_DOT_TOP,
    left: NAV_DOT_LEFT,
    width: NAV_DOT_SIZE,
    height: NAV_DOT_SIZE,
    borderRadius: NAV_DOT_SIZE / 2,
    overflow: "hidden",
  },
  dotOn: { backgroundColor: "#211b10" },
  dotOff: { backgroundColor: "#837F74" },
});
