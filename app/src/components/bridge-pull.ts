/** Pull-down overlay physics. Same GEL family as the nav pill; no third spring. */

/** Rubber past fully open. Full-width sheet: translate, not scaleX. */
export const SHEET_RUBBER = 0.34;
/** Open if released past this (plus velocity). */
export const SHEET_SNAP = 0.36;
export const SHEET_VEL = 0.2;
/** Dimmer at fully open. */
export const SHEET_DIM = 0.46;

export function rubber(over: number): number {
  "worklet";
  if (!(over > 0)) return 0;
  return (over * SHEET_RUBBER) / (1 + over);
}

/** 0 closed, 1 open, >1 rubber past the rest pose. */
export function clampPull(progress: number): number {
  "worklet";
  if (!Number.isFinite(progress)) return 0;
  if (progress < 0) return 0;
  return progress;
}

export function pullFromDrag(start: number, translationY: number, height: number): number {
  "worklet";
  if (!(height > 0)) return clampPull(start);
  const next = start + translationY / height;
  return next < 0 ? 0 : next;
}

export function settlePull(progress: number, velocityY: number, height: number): 0 | 1 {
  "worklet";
  const p = progress > 1 ? 1 : progress < 0 ? 0 : progress;
  const vel = height > 0 ? velocityY / height : 0;
  return p + vel * SHEET_VEL > SHEET_SNAP ? 1 : 0;
}

/** translateY of the sheet. 0 open, −height closed. Past 1, rubber downward. */
export function sheetTranslateY(progress: number, height: number): number {
  "worklet";
  if (!(height > 0)) return 0;
  if (progress >= 1) return rubber(progress - 1) * height;
  return (1 - progress) * -height;
}

/** Slight Y stretch only when rubbering past open — volume, not a layout height anim. */
export function sheetStretchY(progress: number): number {
  "worklet";
  if (progress <= 1) return 1;
  return 1 + rubber(progress - 1) * 0.16;
}

export function backdropOpacity(progress: number): number {
  "worklet";
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  return p * SHEET_DIM;
}
