import { Children, forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, ReduceMotion, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { PagerGestureContext } from "./pager-gesture";
import { navDuration, navProgress } from "../motion";
import type { MainPagerProps, MainPagerRef } from "./MainPager";

/** One UI-thread path on Expo Go and web. No sentinel pages or JS per swipe frame. */
export const MainPager = forwardRef<MainPagerRef, MainPagerProps>(function MainPager(
  { style, page, initialPage, progress: externalProgress, pageWidth = 1, children, onPageSelected }, ref,
) {
  const pages = Children.toArray(children);
  const internalProgress = useSharedValue(initialPage ?? page);
  const progress = externalProgress ?? internalProgress;
  const swiping = useSharedValue(false);
  const start = useSharedValue(0);
  const reduced = useReducedMotion();
  const [visited, setVisited] = useState(() => new Set([initialPage ?? page]));
  const selected = useRef(initialPage ?? page);
  const last = pages.length - 1;
  const completed = (index: number) => {
    selected.current = index;
    setVisited(previous => new Set([...previous, index]));
    onPageSelected?.({ nativeEvent: { position: index } });
  };
  const move = (target: number, velocity: number) => {
    "worklet";
    cancelAnimation(progress);
    const index = Math.max(0, Math.min(last, target));
    const distance = index - progress.value;
    if (distance === 0) return;
    const duration = navDuration(distance, velocity, reduced);
    progress.value = withTiming(index, {
      duration, reduceMotion: ReduceMotion.System,
      easing: (t: number) => {
        "worklet";
        return navProgress(t, distance, velocity, duration);
      },
    }, finished => { if (finished) runOnJS(completed)(index); });
  };
  useImperativeHandle(ref, () => ({ setPage(index) { move(index, 0); } }));
  useEffect(() => { if (page !== selected.current) move(page, 0); }, [page]); // shared-value animation is interrupted, never queued
  const pan = Gesture.Pan().activeOffsetX([-10, 10]).failOffsetY([-14, 14])
    .onBegin(() => { swiping.value = false; cancelAnimation(progress); start.value = progress.value; })
    .onStart(() => { swiping.value = true; })
    .onUpdate(e => { progress.value = Math.max(0, Math.min(last, start.value - e.translationX / pageWidth)); })
    .onEnd(e => {
      const velocity = -e.velocityX / pageWidth;
      move(Math.round(progress.value + velocity * 0.12), velocity);
    })
    .onFinalize((_e, success) => { if (!success) move(Math.round(progress.value), 0); });
  const track = useAnimatedStyle(() => ({ transform: [{ translateX: -progress.value * pageWidth }] }));
  return <PagerGestureContext.Provider value={swiping}><GestureDetector gesture={pan}>
    <View style={[style, { overflow: "hidden" }]} testID="main-pager">
      <Animated.View testID="main-pager-track" style={[{ flex: 1, flexDirection: "row", width: pageWidth * pages.length }, track]}>
        {pages.map((child, index) => <View key={index} style={{ width: pageWidth, flex: 1 }}>
          {visited.has(index) ? child : <View style={{ flex: 1 }} accessibilityLabel="Loading workspace" />}
        </View>)}
      </Animated.View>
    </View>
  </GestureDetector></PagerGestureContext.Provider>;
});
