import { LAYOUTS, layoutSizing, type LayoutDensity } from "./density";

export type Density = LayoutDensity;
export const DENSITIES: readonly Density[] = LAYOUTS;

/** Minimums, not fixed heights: font scaling may grow rows; plots stretch without an aspect lock. */
export function componentSizing(density: Density, fontScale = 1) {
  return layoutSizing(density, fontScale);
}

/** Keep enough readable width for padding and large-type labels before choosing columns. */
export function tileColumns(availableWidth: number, density: Density, fontScale = 1, gap = 8): number {
  const minimum = density === "compact" ? 96 : density === "spacious" ? 124 : 112;
  return Math.max(1, Math.min(3, Math.floor((availableWidth + gap) / (minimum * Math.max(1, fontScale) + gap))));
}

export function radialCenter(x: number, y: number, width: number, height: number, radius = 140) {
  "worklet";
  const inset = radius + 12;
  return { x: Math.max(inset, Math.min(width - inset, x)), y: Math.max(inset, Math.min(height - inset, y)) };
}

export function radialSector(dx: number, dy: number, count: number, left: boolean, deadZone = 30): number {
  "worklet";
  if (count < 4 || count > 8 || Math.hypot(dx, dy) < deadZone) return -1;
  const angle = Math.atan2(dy, left ? -dx : dx) + Math.PI / 2;
  return ((Math.round(angle / (2 * Math.PI / count)) % count) + count) % count;
}

export function radialPosition(index: number, count: number, left: boolean, radius = 84) {
  "worklet";
  const a = index * 2 * Math.PI / count - Math.PI / 2;
  return { x: Math.cos(a) * radius * (left ? -1 : 1), y: Math.sin(a) * radius };
}
