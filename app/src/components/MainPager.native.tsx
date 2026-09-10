import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import PagerView from "react-native-pager-view";
import Animated, { useEvent, useHandler, type SharedValue } from "react-native-reanimated";
import type { MainPagerProps, MainPagerRef } from "./MainPager";

const AnimatedPagerView = Animated.createAnimatedComponent(PagerView);

function usePagerProgressHandler(progress: SharedValue<number> | undefined) {
  const handlers = {
    onPageScroll: (e: { position: number; offset: number }) => {
      "worklet";
      if (progress == null) return;
      const n = e.position + e.offset;
      progress.value = n < 0 ? 0 : n > 2 ? 2 : n;
    },
  };
  const { context, doDependenciesDiffer } = useHandler(handlers, [progress]);
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
  { style, page, initialPage, onPageSelected, onPageScroll, progress, overdrag, children },
  ref,
) {
  const inner = useRef<PagerView>(null);
  const fromPager = useRef<number | null>(null);
  const onPageScrollWorklet = usePagerProgressHandler(progress);

  useImperativeHandle(ref, () => ({
    setPage(index: number) {
      fromPager.current = null;
      inner.current?.setPage(index);
    },
  }));

  useEffect(() => {
    if (fromPager.current === page) {
      fromPager.current = null;
      return;
    }
    inner.current?.setPage(page);
  }, [page]);

  return (
    <AnimatedPagerView
      ref={inner}
      style={style}
      initialPage={initialPage ?? page}
      onPageSelected={(e) => {
        fromPager.current = e.nativeEvent.position;
        onPageSelected?.(e);
      }}
      onPageScroll={progress ? onPageScrollWorklet : onPageScroll}
      overdrag={overdrag}
    >
      {children}
    </AnimatedPagerView>
  );
});
