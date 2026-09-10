import { forwardRef, memo, useImperativeHandle } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import type { NavigationProp } from "@react-navigation/native";
import { haptic } from "../haptics";
import type { RootStackParamList } from "../navigation";
import {
  DEV_NAV_96,
  GOLD_68,
  GOLD_GLOW,
  GOLD_RIM,
  NAV_CHROME_HEIGHT,
  NAV_PAGER_HEIGHT,
  NAV_PAGER_PAD,
  NAV_PAGER_WIDTH,
  NAV_PILL_HEIGHT,
  NAV_SLOT_WIDTH,
  TAB_LABELS,
  clampProgress,
  clampTab,
  indicatorTranslateX,
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
 * Chrome matches the collapsed 60px CSS bar: frost fill, cream hair, gold glow + inset.
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

    const pillStyle = useAnimatedStyle(() => {
      const p = progress.value;
      const n = p < 0 ? 0 : p > 2 ? 2 : p;
      return { transform: [{ translateX: n * NAV_SLOT_WIDTH }] };
    });
    void indicatorTranslateX;

    const goTab = (next: number) => {
      haptic.tap();
      if (onTab) onTab(next);
      else navigation.navigate("Main", { tab: next });
    };

    const active = clampTab(tab);

    return (
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Expand"
            android_ripple={RIPPLE}
            onPress={() => {
              haptic.tap();
              navigation.navigate("Voice");
            }}
            style={styles.circle}
          >
            <Image source={expandSrc} style={styles.expandIcon} />
            <View pointerEvents="none" style={styles.circleHair} />
          </Pressable>
          <View style={styles.pager} accessibilityLabel="Primary mobile workspace">
            <Animated.View pointerEvents="none" style={[styles.pillTrack, pillStyle]}>
              <View style={styles.glow} />
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
                  android_ripple={RIPPLE}
                  onPress={() => goTab(i)}
                  style={styles.tab}
                >
                  <View style={[styles.dot, i === active ? styles.dotOn : styles.dotOff]} />
                </Pressable>
              ))}
            </View>
            <View pointerEvents="none" style={styles.hair} />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Menu"
            android_ripple={RIPPLE}
            onPress={() => {
              haptic.tap();
              navigation.navigate("Settings");
            }}
            style={styles.circle}
          >
            <Image source={chevronSrc} style={styles.chevronIcon} />
            <View pointerEvents="none" style={styles.circleHair} />
          </Pressable>
        </View>
      </View>
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
    borderRadius: 23,
    backgroundColor: DEV_NAV_96,
    overflow: "visible",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 9 },
  },
  hair: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 23,
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
  glow: {
    position: "absolute",
    top: 4,
    left: 2,
    right: 2,
    bottom: -2,
    borderRadius: 16,
    backgroundColor: GOLD_GLOW,
  },
  pill: {
    flex: 1,
    borderRadius: 16,
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
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    padding: NAV_PAGER_PAD,
    zIndex: 1,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center" },
  dot: { width: 4, height: 4, borderRadius: 2, overflow: "hidden" },
  dotOn: { backgroundColor: "#211b10" },
  dotOff: { backgroundColor: "#837F74" },
});
