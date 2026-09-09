import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

/** Cross-platform pager ref — native swipe + web tab sync. */
export interface MainPagerRef {
  setPage(index: number): void;
}

export interface MainPagerProps {
  style?: StyleProp<ViewStyle>;
  /** Active page (controlled). */
  page: number;
  initialPage?: number;
  onPageSelected?: (e: { nativeEvent: { position: number } }) => void;
  overdrag?: boolean;
  children: ReactNode;
}

/** TypeScript + native default; Metro swaps in MainPager.web.tsx on web. */
export { MainPager } from "./MainPager.native";
