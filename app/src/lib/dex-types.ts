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
}
export const DEX_OFF: DexState = { available: false, mode: "off", source: "none", tvDisplayId: null, mainDisplayId: 0, padOpen: false };
export interface DexSimulation { mode: DexState["mode"]; tv?: { w: number; h: number } }
export type DexListener = (state: DexState) => void;
