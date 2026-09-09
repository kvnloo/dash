import { Children, forwardRef, useImperativeHandle } from "react";
import { View } from "react-native";
import type { MainPagerProps, MainPagerRef } from "./MainPager";

/** Web fallback — react-native-pager-view has no web build. */
export const MainPager = forwardRef<MainPagerRef, MainPagerProps>(function MainPager({ style, page, children }, ref) {
  useImperativeHandle(ref, () => ({
    setPage() {
      /* Tab index is controlled by MainScreen; noop on web. */
    },
  }));

  const pages = Children.toArray(children);
  return <View style={style}>{pages[page] ?? null}</View>;
});
