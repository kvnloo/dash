import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import PagerView from "react-native-pager-view";
import type { MainPagerProps, MainPagerRef } from "./MainPager";

export const MainPager = forwardRef<MainPagerRef, MainPagerProps>(function MainPager(
  { style, page, initialPage, onPageSelected, onPageScroll, overdrag, children },
  ref,
) {
  const inner = useRef<PagerView>(null);

  useImperativeHandle(ref, () => ({
    setPage(index: number) {
      inner.current?.setPage(index);
    },
  }));

  useEffect(() => {
    inner.current?.setPage(page);
  }, [page]);

  return (
    <PagerView
      ref={inner}
      style={style}
      initialPage={initialPage ?? page}
      onPageSelected={onPageSelected}
      onPageScroll={onPageScroll}
      overdrag={overdrag}
    >
      {children}
    </PagerView>
  );
});
