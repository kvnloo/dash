export interface DexState {
  available: boolean;
  mode: "off" | "dual" | "standalone";
  source: string;
  tvDisplayId: number | null;
  mainDisplayId: number;
  padOpen: boolean;
  tv?: { w: number; h: number };
  /** Native: a real mouse/touchpad is attached. */
  pointer?: boolean;
  /** Native: Configuration.screenWidthDp of the main activity. */
  widthDp?: number;
  /** Native: the activity's own ui mode is UI_MODE_TYPE_DESK. */
  uiModeDesk?: boolean;
  /**
   * Native: any desktop signal, including One UI 9's launcher-integrated DeX on Android desktop
   * windowing (a freeform window on a tablet-sized display, or an external presentation display).
   * Feeds the desk layout only; `mode` (Pad, window moves) ignores it.
   */
  desktop?: boolean;
  /** Native: which signal set `desktop` ("freeform-window", "external-display", or `source`). */
  desktopSource?: string;
  /** Native: the main activity is in a freeform (floating, resizable) window. */
  freeform?: boolean;
  /** Native: a public external display is on (DeX/HDMI/Wireless DeX candidate). */
  externalDisplayId?: number | null;
}
export const DEX_OFF: DexState = { available: false, mode: "off", source: "none", tvDisplayId: null, mainDisplayId: 0, padOpen: false };
export interface DexSimulation { mode: DexState["mode"]; tv?: { w: number; h: number }; desktop?: "freeform-window" | "external-display" }
export type DexListener = (state: DexState) => void;
