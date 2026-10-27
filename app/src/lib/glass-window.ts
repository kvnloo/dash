/** Web / test stub: there is no window wallpaper or system blur outside Android. */
export interface GlassWindowState {
  readonly sdk: number;
  readonly supported: boolean;
  readonly crossWindowBlurEnabled: boolean;
  readonly showsWallpaper: boolean;
  readonly mode: "blur" | "disabled" | "unsupported";
  readonly backgroundBlurPx: number;
  readonly blurBehindPx: number;
}

export interface WindowGlass {
  /** Window.setBackgroundBlurRadius, dp. 0 clears it. */
  readonly blurRadius: number;
  /** FLAG_BLUR_BEHIND + setBlurBehindRadius, dp. 0 clears the flag. */
  readonly behindRadius?: number;
}

export const UNSUPPORTED: GlassWindowState = {
  sdk: 0, supported: false, crossWindowBlurEnabled: false, showsWallpaper: false,
  mode: "unsupported", backgroundBlurPx: 0, blurBehindPx: 0,
};

export function glassWindowAvailable(): boolean { return false; }
export function glassWindowState(): GlassWindowState { return UNSUPPORTED; }
export async function setWindowGlass(_: WindowGlass): Promise<GlassWindowState> { return UNSUPPORTED; }
export function onCrossWindowBlurChanged(_: (enabled: boolean) => void): () => void { return () => {}; }
