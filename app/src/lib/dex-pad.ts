/** The phone and TV React surfaces share one ReactHost, not a network connection. */
export type PadPoint = { x: number; y: number };
export type PadSample = PadPoint & { t: number };
type PadEvent =
  | { type: "ink"; points: PadSample[]; done: boolean }
  | { type: "pinch"; from: PadPoint; to: PadPoint; scale: number }
  | { type: "cancel" | "reset" };
const listeners = new Set<(event: PadEvent) => void>();
export function sendPadEvent(event: PadEvent) {
  for (const listener of listeners) listener(event);
}
export function subscribePad(listener: (event: PadEvent) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export const PAD_CAMERA_HOME = { x: 0, y: 0, scale: 1 };
export function pinchPadCamera(camera: typeof PAD_CAMERA_HOME, from: PadPoint, to: PadPoint, scale: number) {
  const zoom = Math.min(4, Math.max(1, camera.scale * scale));
  const limit = (offset: number) => Math.min(0, Math.max(1 - zoom, offset));
  return {
    scale: zoom,
    x: limit(to.x - (from.x - camera.x) * zoom / camera.scale),
    y: limit(to.y - (from.y - camera.y) * zoom / camera.scale),
  };
}

// Letterbox the phone surface to the real destination viewport, not the TV's
// display mode: Dash may occupy only part of the desktop.
let aspect = 16 / 9;
const aspectListeners = new Set<() => void>();
export const padAspect = () => aspect;
export function subscribePadAspect(listener: () => void) {
  aspectListeners.add(listener);
  return () => { aspectListeners.delete(listener); };
}
export function setPadAspect(next: number) {
  if (aspect === next) return;
  aspect = next;
  for (const listener of aspectListeners) listener();
}
