/** Last touch anywhere in the app. The root view reports touches without claiming them. */
let lastTouchMs = Date.now();

export function markTouch(): void {
  lastTouchMs = Date.now();
}

/** Responder-capture handler: records the touch and never claims it, so children keep every gesture. */
export function observeTouch(): false {
  markTouch();
  return false;
}

export function idleMs(nowMs: number = Date.now()): number {
  return Math.max(0, nowMs - lastTouchMs);
}
