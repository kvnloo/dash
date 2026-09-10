import { forwardRef, memo, useImperativeHandle } from "react";
import { Image, StyleSheet, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
} from "react-native-reanimated";
import type { NavigationProp } from "@react-navigation/native";
import { haptic } from "../haptics";
import { PRESS_SCALE } from "../motion";
import type { RootStackParamList } from "../navigation";
import { useBridgePullOptional, useBridgePullPan } from "./BridgePull";
import { PressScale } from "./PressScale";
import {
  DEV_NAV_96,
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
  TAB_LABELS,
  clampProgress,
  clampTab,
  indicatorTranslateX,
  pillStep,
  pillStretch,
} from "./golden-nav";

const expandSrc = require("../../assets/nav-expand.png");
const chevronSrc = require("../../assets/nav-chevron.png");

const RIPPLE = { color: "transparent" as const };

export type AppNavHandle = {
  /** Drive the gold pill with PagerView position+offset. UI-thread shared value; no React render. */
  setProgress(progress: number): void;
};

/**
 * Native AppNav is a Reanimated view, not a WebView.
 * The pill tracks a shared value written on the UI thread by PagerView.
 * Chrome matches the collapsed 60px CSS bar: frost fill, cream hair, inset spec/shade.
 * The gold pill is a gel: UI-thread spring follow, stretch on travel, squash on Y.
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
    const internal = useSharedValue(clampProgress(tab));
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

    const follow = useSharedValue(clampProgress(tab));
    const vel = useSharedValue(0);

    useFrameCallback((info) => {
      const raw = info.timeSincePreviousFrame;
      if (raw == null) return;
      const dt = Math.min(0.033, raw / 1000);
      if (dt <= 0) return;
      const next = pillStep(follow.value, vel.value, progress.value, dt);
      follow.value = next.pos;
      vel.value = next.vel;
    });

    const pillStyle = useAnimatedStyle(() => {
      const p = progress.value;
      const n = follow.value;
      const { scaleX, scaleY } = pillStretch(n, p, vel.value);
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
      else navigation.navigate("Main", { tab: next });
    };

    const active = clampTab(tab);
    const pull = useBridgePullOptional();
    const pullPan = useBridgePullPan();
    const chevronStyle = useAnimatedStyle(() => {
      const p = pull ? pull.progress.value : 0;
      const n = p < 0 ? 0 : p > 1 ? 1 : p;
      return { transform: [{ rotateZ: `${n * 180}deg` }] };
    });

    return (
      <GestureDetector gesture={pullPan}>
      <View style={styles.wrap} pointerEvents="box-none" collapsable={false}>
        <View style={styles.row}>
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
            <Image source={expandSrc} style={styles.expandIcon} />
            <View pointerEvents="none" style={styles.circleHair} />
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
                <PressScale
                  key={label}
                  accessibilityRole="tab"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: i === active }}
                  android_ripple={RIPPLE}
                  scaleTo={PRESS_SCALE.nav}
                  onPress={() => goTab(i)}
                  style={styles.tab}
                >
                  <View style={[styles.dot, i === active ? styles.dotOn : styles.dotOff]} />
                </PressScale>
              ))}
            </View>
            <View pointerEvents="none" style={styles.hair} />
          </View>
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
            <Animated.View style={chevronStyle}>
              <Image source={chevronSrc} style={styles.chevronIcon} />
            </Animated.View>
            <View pointerEvents="none" style={styles.circleHair} />
          </PressScale>
        </View>
      </View>
      </GestureDetector>
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
    paddingHorizontal: 16,
    overflow: "visible",
  },
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DEV_NAV_96,
    overflow: "visible",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 8 },
  },
  circleHair: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(236,232,223,0.16)",
  },
  expandIcon: { width: 17, height: 17, tintColor: "#B4AFA3" },
  chevronIcon: { width: 15, height: 15, tintColor: "#B4AFA3" },
  pager: {
    width: NAV_PAGER_WIDTH,
    height: NAV_PAGER_HEIGHT,
    borderRadius: NAV_PAGER_RADIUS,
    backgroundColor: DEV_NAV_96,
    overflow: "visible",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 9 },
  },
  hair: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: NAV_PAGER_RADIUS,
    borderWidth: 1,
    borderColor: "rgba(236,232,223,0.16)",
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
    backgroundColor: GOLD_68,
    borderWidth: 1,
    borderColor: GOLD_RIM,
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
  dot: { width: 4, height: 4, borderRadius: 2, overflow: "hidden" },
  dotOn: { backgroundColor: "#211b10" },
  dotOff: { backgroundColor: "#837F74" },
});
