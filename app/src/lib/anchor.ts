import { findNodeHandle, Platform, type View } from "react-native";
import { KeyboardControllerNative } from "react-native-keyboard-controller";

export interface AnchorRect { x: number; y: number; width: number; height: number }

/** After an IME hide: a few frames of agreement, not one. The first frames after the hide event can still be the lifted dock. */
export const AFTER_IME_QUIET_MS = 80;
const SETTLE_TIMEOUT_MS = 800;
/** Under half a dp is rounding noise, not movement. */
const MOVED_DP = 0.5;

const usable = (rect: AnchorRect): boolean => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;

export function sameRect(a: AnchorRect, b: AnchorRect): boolean {
  return Math.abs(a.x - b.x) < MOVED_DP && Math.abs(a.y - b.y) < MOVED_DP && Math.abs(a.width - b.width) < MOVED_DP && Math.abs(a.height - b.height) < MOVED_DP;
}

function measureInWindow(node: View): Promise<AnchorRect | null> {
  return new Promise(resolve => node.measureInWindow((x, y, width, height) => resolve(usable({ x, y, width, height }) ? { x, y, width, height } : null)));
}

/**
 * Where a view really is on screen, in dp, for anchoring a popup to it.
 *
 * `measureInWindow` is the window-relative rectangle React Native computes for the view, and on
 * edge-to-edge Android it is offset by the status bar. KeyboardController asks the native view for its
 * screen location instead, which is the position the owner sees and the one a Modal overlay (also
 * measured this way) shares. Web has real DOM geometry, so it keeps `measureInWindow`.
 */
export async function measureAnchor(node: View | null): Promise<AnchorRect | null> {
  if (!node) return null;
  if (Platform.OS !== "web") {
    try {
      const tag = findNodeHandle(node);
      // An installed dev client older than this JS may not carry the method, and an unlinked module's
      // binding throws on any property read: both fall through to the window measure.
      if (tag !== null && typeof KeyboardControllerNative.viewPositionInWindow === "function") {
        const rect = await KeyboardControllerNative.viewPositionInWindow(tag);
        if (usable(rect)) return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
    } catch {
      // View gone or module unavailable: the window measure below still answers.
    }
  }
  return measureInWindow(node);
}

const nextFrame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()));

/**
 * Measure once the view has stopped moving. Two frames in a row must agree, and the position must have
 * been unchanged for `quietMs`: 0 when nothing was animating the view (the IME was already down), or
 * AFTER_IME_QUIET_MS when the tap itself hid the IME and the dock is about to come down. Resolves with
 * the last measure when the view never settles within the timeout.
 */
export async function settledAnchor(node: () => View | null, isCurrent: () => boolean = () => true, quietMs: number = AFTER_IME_QUIET_MS): Promise<AnchorRect | null> {
  const started = Date.now();
  let last = await measureAnchor(node());
  let steadySince = Date.now();
  let agreeing = false;
  while (isCurrent() && last && Date.now() - started < SETTLE_TIMEOUT_MS && !(agreeing && Date.now() - steadySince >= quietMs)) {
    await nextFrame();
    const next = await measureAnchor(node());
    if (!next) break;
    agreeing = sameRect(last, next);
    if (!agreeing) steadySince = Date.now();
    last = next;
  }
  return isCurrent() ? last : null;
}

/** Report the view's rectangle whenever it differs from `from`, until the returned function is called. */
export function followAnchor(node: () => View | null, from: AnchorRect, onMove: (rect: AnchorRect) => void): () => void {
  let live = true;
  let reading = false;
  let last = from;
  let frame = 0;
  const tick = () => {
    if (!live) return;
    frame = requestAnimationFrame(tick);
    if (reading) return;
    reading = true;
    void measureAnchor(node()).then(rect => {
      reading = false;
      if (!live || !rect || sameRect(last, rect)) return;
      last = rect;
      onMove(rect);
    });
  };
  frame = requestAnimationFrame(tick);
  return () => { live = false; cancelAnimationFrame(frame); };
}
