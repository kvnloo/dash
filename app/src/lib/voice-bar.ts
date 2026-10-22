import type { EdgeInsets } from "react-native-safe-area-context";

/** Min height of the app-wide voice bar's own row (44 pt buttons + 1 pt borders), used until it is measured. */
export const VOICE_BAR_ROW = 46;

/**
 * Insets the app below the voice root sees. While a call is live the bar OWNS a band under the status
 * bar, so every screen that already respects the top safe-area inset (AppNav/tabs, headers, Chat)
 * lays out below it instead of under it. Device insets are untouched when no call is live.
 */
export function appInsets(device: EdgeInsets, live: boolean, measuredRow = 0): EdgeInsets {
  if (!live) return device;
  const row = Number.isFinite(measuredRow) && measuredRow > 0 ? measuredRow : VOICE_BAR_ROW;
  return { ...device, top: device.top + row };
}

/** One home for Mute/End: the full-screen chat window's dock row, otherwise the app-wide bar. */
export function voiceControlHome(live: boolean, windowOpen: boolean): "none" | "bar" | "window" {
  return !live ? "none" : windowOpen ? "window" : "bar";
}
