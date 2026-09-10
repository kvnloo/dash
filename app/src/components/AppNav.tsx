import { forwardRef, useEffect, useImperativeHandle } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import type { NavigationProp } from "@react-navigation/native";
import { haptic } from "../haptics";
import type { RootStackParamList } from "../navigation";
import {
  DEV_NAV_96,
  GOLD_68,
  GOLD_GLOW,
  GOLD_RIM,
  NAV_SLOT_WIDTH,
  TAB_LABELS,
  clampProgress,
  clampTab,
  indicatorTranslateX,
} from "./golden-nav";

const expandSrc = require("../../assets/nav-expand.png");
const chevronSrc = require("../../assets/nav-chevron.png");

export type AppNavHandle = {
  /** Drive the gold pill with PagerView position+offset. UI-thread shared value; no React render. */
  setProgress(progress: number): void;
};

/**
 * Native AppNav is a Reanimated view, not a WebView.
 * Per-frame WebView JS dropped Expo FPS and Android dropped CSS ::after dots.
 */
export const AppNav = forwardRef<
  AppNavHandle,
  {
    navigation: NavigationProp<RootStackParamList>;
    tab: number;
    onTab?(next: number): void;
  }
>(function AppNav({ navigation, tab, onTab }, ref) {
  const progress = useSharedValue(clampProgress(tab));

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
    progress.value = clampProgress(tab);
  }, [progress, tab]);

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
          onPress={() => {
            haptic.tap();
            navigation.navigate("Voice");
          }}
          style={styles.circle}
        >
          <Image source={expandSrc} style={styles.expandIcon} />
        </Pressable>
        <View style={styles.pager} accessibilityLabel="Primary mobile workspace">
          <Animated.View
            pointerEvents="none"
            renderToHardwareTextureAndroid
            style={[styles.pill, pillStyle]}
          />
          <View style={styles.tabs}>
            {TAB_LABELS.map((label, i) => (
              <Pressable
                key={label}
                accessibilityRole="tab"
                accessibilityLabel={label}
                accessibilityState={{ selected: i === active }}
                onPress={() => goTab(i)}
                style={styles.tab}
              >
                <View style={[styles.dot, i === active ? styles.dotOn : styles.dotOff]} />
              </Pressable>
            ))}
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Menu"
          onPress={() => {
            haptic.tap();
            navigation.navigate("Settings");
          }}
          style={styles.circle}
        >
          <Image source={chevronSrc} style={styles.chevronIcon} />
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { height: 80, backgroundColor: "transparent", overflow: "visible" },
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
    borderWidth: 1,
    borderColor: "rgba(236,232,223,0.16)",
  },
  expandIcon: { width: 17, height: 17, tintColor: "#B4AFA3" },
  chevronIcon: { width: 15, height: 15, tintColor: "#B4AFA3" },
  pager: {
    width: 144,
    height: 50,
    borderRadius: 23,
    backgroundColor: DEV_NAV_96,
    borderWidth: 1,
    borderColor: "rgba(236,232,223,0.16)",
    overflow: "visible",
  },
  pill: {
    position: "absolute",
    top: 3,
    left: 3,
    width: 46,
    height: 44,
    borderRadius: 16,
    backgroundColor: GOLD_68,
    borderWidth: 1,
    borderColor: GOLD_RIM,
    shadowColor: GOLD_GLOW,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 6,
  },
  tabs: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    padding: 3,
    zIndex: 1,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center" },
  dot: { width: 4, height: 4, borderRadius: 2 },
  dotOn: { backgroundColor: "#211b10" },
  dotOff: { backgroundColor: "#837F74" },
});
