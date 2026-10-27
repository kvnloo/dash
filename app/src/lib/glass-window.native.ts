import { Platform } from "react-native";
import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";
import { UNSUPPORTED, type GlassWindowState, type WindowGlass } from "./glass-window";

export { UNSUPPORTED, type GlassWindowState, type WindowGlass } from "./glass-window";

type GlassModule = {
  state(): unknown;
  set(blurRadius: number, behindRadius: number): Promise<unknown>;
  addListener(event: "onCrossWindowBlurChanged", fn: (e: { enabled: boolean }) => void): EventSubscription;
};

// Optional: Expo Go, iOS and APKs built before app/modules/dash-glass keep the tint-only fallback.
const native = Platform.OS === "android" ? requireOptionalNativeModule<GlassModule>("DashGlassWindow") : null;

function parse(raw: unknown): GlassWindowState {
  if (!raw || typeof raw !== "object") return UNSUPPORTED;
  const r = raw as Record<string, unknown>;
  const mode = r.mode === "blur" || r.mode === "disabled" ? r.mode : "unsupported";
  return {
    sdk: typeof r.sdk === "number" ? r.sdk : 0,
    supported: r.supported === true,
    crossWindowBlurEnabled: r.crossWindowBlurEnabled === true,
    showsWallpaper: r.showsWallpaper === true,
    mode,
    backgroundBlurPx: typeof r.backgroundBlurPx === "number" ? r.backgroundBlurPx : 0,
    blurBehindPx: typeof r.blurBehindPx === "number" ? r.blurBehindPx : 0,
  };
}

export function glassWindowAvailable(): boolean { return native !== null; }

export function glassWindowState(): GlassWindowState {
  if (!native) return UNSUPPORTED;
  try { return parse(native.state()); } catch { return UNSUPPORTED; }
}

/**
 * Apply native window blur. API 31+ and only while WindowManager.isCrossWindowBlurEnabled();
 * otherwise this resolves with mode "disabled"/"unsupported" and the caller keeps tint only.
 */
export async function setWindowGlass({ blurRadius, behindRadius = 0 }: WindowGlass): Promise<GlassWindowState> {
  if (!native) return UNSUPPORTED;
  try { return parse(await native.set(blurRadius, behindRadius)); } catch { return UNSUPPORTED; }
}

/** Battery saver / "Allow window-level blurs" flips this live on API 31+. */
export function onCrossWindowBlurChanged(fn: (enabled: boolean) => void): () => void {
  if (!native) return () => {};
  const sub = native.addListener("onCrossWindowBlurChanged", e => fn(e.enabled === true));
  return () => sub.remove();
}
