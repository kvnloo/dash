/**
 * Presentation policy for the Chat route. A row origin enables a morph; it must
 * not be the only way to reach the native cutout pill.
 *
 * The screen and navigation entry points are wired by the integration owner.
 */
import { pillReserve, type PillGeometry, type WindowOrigin } from "./chat-window";

export type ChatEntry = "row" | "notification" | "deep-link" | "search" | "new-chat" | "restore";
export type ChatChromeMode = "window" | "fullscreen" | "header";
export type ChatCloseAction = "pop" | "to-main";

export interface ChatChrome {
  mode: ChatChromeMode;
  /** Only a measured Chats-list row is allowed to animate from a source rectangle. */
  morph: boolean;
  /** Direct-entry chats return to Main, not an unrelated screen in the stack. */
  closeAction: ChatCloseAction;
  /** Reserve the cutout pill in native modes and the safe-area inset in header mode. */
  topReserve(geometry: PillGeometry, insetTop: number): number;
}

export interface ChatChromeInput {
  entry: ChatEntry;
  windowOrigin?: WindowOrigin;
  /** Undefined preserves the native full-screen default; explicit false opts out. */
  fullscreenSetting?: boolean;
  /** The Live surface uses the same chrome as its parent chat; toggling it must not remount chrome. */
  liveSurface: boolean;
  web: boolean;
}

function measured(origin: WindowOrigin | undefined): boolean {
  return origin !== undefined
    && Number.isFinite(origin.y)
    && Number.isFinite(origin.height)
    && origin.height > 0;
}

function headerReserve(_geometry: PillGeometry, insetTop: number): number {
  return insetTop;
}

/**
 * Web always keeps ScreenHeader. Native uses the pill, including when opened
 * without a list-row rectangle. Only a row with usable measurements morphs.
 *
 * Live surface does not affect the decision: switching surfaces must not
 * replace the surrounding window, close target, or top inset.
 */
export function resolveChatChrome(input: ChatChromeInput): ChatChrome {
  const mode: ChatChromeMode =
    input.web || input.fullscreenSetting === false
      ? "header"
      : input.entry === "row" && measured(input.windowOrigin)
        ? "window"
        : "fullscreen";

  const closeAction: ChatCloseAction =
    input.entry === "notification" || input.entry === "deep-link" || input.entry === "restore"
      ? "to-main"
      : "pop";

  return {
    mode,
    morph: mode === "window",
    closeAction,
    topReserve: mode === "header" ? headerReserve : pillReserve,
  };
}
