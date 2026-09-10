import { Children, forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { View } from "react-native";
import PagerView from "react-native-pager-view";
import Animated, { useEvent, useHandler, useSharedValue, type SharedValue } from "react-native-reanimated";
import type { MainPagerProps, MainPagerRef } from "./MainPager";

const AnimatedPagerView = Animated.createAnimatedComponent(PagerView);

/** Empty sentinel pages on each side so Android can actually scroll past 0 and last. */
const BOUNCE = 1;

function usePagerProgressHandler(progress: SharedValue<number> | undefined, armed: SharedValue<number>) {
  const handlers = {
    onPageScroll: (e: { position: number; offset: number }) => {
      "worklet";
      if (progress == null) return;
      if (armed.value === 0) return;
      progress.value = e.position + e.offset - BOUNCE;
    },
  };
  const { context, doDependenciesDiffer } = useHandler(handlers, [progress, armed]);
  return useEvent(
    (event) => {
      "worklet";
      const { onPageScroll } = handlers;
      if (onPageScroll && String(event.eventName ?? "").endsWith("onPageScroll")) {
        onPageScroll(event, context);
      }
    },
    ["onPageScroll"],
    doDependenciesDiffer,
  );
}

export const MainPager = forwardRef<MainPagerRef, MainPagerProps>(function MainPager(
  { style, page, initialPage, onPageSelected, onPageScroll, progress, overdrag, pageWidth, children },
  ref,
) {
  const inner = useRef<PagerView>(null);
  const fromPager = useRef<number | null>(null);
  const armed = useSharedValue(0);
  const onPageScrollWorklet = usePagerProgressHandler(progress, armed);
  const realCount = Children.count(children);
  const bounceEnd = realCount + BOUNCE;

  const setInternalPage = (real: number) => {
    inner.current?.setPage(real + BOUNCE);
  };

  useImperativeHandle(ref, () => ({
    setPage(index: number) {
      fromPager.current = null;
      setInternalPage(index);
    },
  }));

  useEffect(() => {
    if (fromPager.current === page) {
      fromPager.current = null;
      return;
    }
    setInternalPage(page);
  }, [page]);

  return (
    <AnimatedPagerView
      ref={inner}
      style={style}
      initialPage={(initialPage ?? page) + BOUNCE}
      offscreenPageLimit={1}
      overScrollMode="always"
      onPageSelected={(e) => {
        const internal = e.nativeEvent.position;
        if (internal <= 0) {
          inner.current?.setPage(BOUNCE);
          armed.value = 1;
          fromPager.current = 0;
          onPageSelected?.({ nativeEvent: { position: 0 } });
          return;
        }
        if (internal >= bounceEnd) {
          inner.current?.setPage(realCount);
          armed.value = 1;
          fromPager.current = realCount - 1;
          onPageSelected?.({ nativeEvent: { position: realCount - 1 } });
          return;
        }
        const real = internal - BOUNCE;
        fromPager.current = real;
        armed.value = 1;
        if (progress) progress.value = real;
        onPageSelected?.({ nativeEvent: { position: real } });
      }}
      onPageScroll={progress ? onPageScrollWorklet : onPageScroll}
      overdrag={overdrag}
    >
      <View key="bounce-start" collapsable={false} style={{ width: pageWidth, flex: 1 }} />
      {children}
      <View key="bounce-end" collapsable={false} style={{ width: pageWidth, flex: 1 }} />
    </AnimatedPagerView>
  );
});
