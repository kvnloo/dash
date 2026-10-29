import { createContext, createElement, useContext, type ReactNode } from "react";
import { useWindowDimensions } from "react-native";

/**
 * The size of the pane a screen is drawn in. Desk mode puts the navigator in its centre column, so
 * screens that lay out from the window (Main's pages, the chat window pill) read this instead. With
 * no provider (every phone layout) it is exactly `useWindowDimensions()`.
 */
const PaneSizeContext = createContext<{ width: number; height: number } | null>(null);

export function PaneSizeProvider({ size, children }: { size: { width: number; height: number } | null; children: ReactNode }) {
  return createElement(PaneSizeContext.Provider, { value: size }, children);
}

export function usePaneDimensions(): { width: number; height: number } {
  const window = useWindowDimensions();
  const pane = useContext(PaneSizeContext);
  return pane ?? window;
}
