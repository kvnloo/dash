// Vendored from kvnloo/blueprint 2817939 (GPL-3.0-only). See README.md.
/**
 * Shared camera maths for the Living Ruins wallpaper.
 *
 * Plate coordinates are normalised 0..1 with the origin at the TOP-LEFT of the
 * 16:9 plate. Screen coordinates are normalised 0..1 with the origin at the
 * top-left of the viewport. The mapping is a cover-fit:
 *
 *   plate = screen * scale + offset + parallax * (depth - 0.5)
 *
 * The WebGL shaders, the particle vertex shader and the DOM hotspots all use
 * this one mapping, so markers stay glued to their landmarks.
 */

export const PLATE_ASPECT = 16 / 9;
/** Base zoom so parallax and camera drift never expose the plate edge. */
export const OVERSCAN = 1.07;
/** Maximum parallax shift in plate units (per unit of depth from mid-ground). */
export const MAX_PARALLAX = 0.022;

export type View = {
  /** plate units per screen unit */
  sx: number;
  sy: number;
  /** plate coordinate of the screen's top-left corner */
  ox: number;
  oy: number;
};

export type Camera = View & {
  /** current parallax vector in plate units */
  px: number;
  py: number;
  /** 0..1, how far the page is scrolled past the hero (drives dimming) */
  dim: number;
  width: number;
  height: number;
};

export type ViewOptions = {
  /** extra zoom on top of OVERSCAN (scroll-linked drift) */
  zoom?: number;
  /** vertical drift in plate units, positive = camera moves down the plate */
  driftY?: number;
  /** horizontal pan in plate units (portrait auto-pan), positive = camera moves right */
  panX?: number;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Cover-fit the plate into a viewport. On portrait screens only about a quarter
 * of the plate width fits, so the crop rests on the water wheel (focal x ~0.47,
 * greenhouse on the left, waterfall on the right) and the live player pans it
 * slowly between the greenhouse and the waterfall (see portraitPan). It is
 * anchored near the bottom so the water stays in frame.
 *
 * The offset uses CSS `object-position` semantics (offset = P * (1 - visible))
 * so the static poster in index.html, styled with object-position P and
 * transform: scale(OVERSCAN) about origin P, shows exactly the same crop.
 */
export const POSTER_POSITION = {
  landscape: { x: 0.5, y: 0.5 },
  portrait: { x: 0.47, y: 0.92 },
};

/** Portrait auto-pan: focal centre swings +-PAN_AMPLITUDE plate widths over PAN_PERIOD seconds. */
export const PAN_PERIOD = 40;
export const PAN_AMPLITUDE = 0.21;
export function portraitPan(t: number) {
  return PAN_AMPLITUDE * Math.sin((t / PAN_PERIOD) * Math.PI * 2);
}

export function coverView(width: number, height: number, opts: ViewOptions = {}): View {
  const aspect = Math.max(1e-3, width / Math.max(1, height));
  let fx = 1;
  let fy = 1;
  if (aspect >= PLATE_ASPECT) fy = PLATE_ASPECT / aspect;
  else fx = aspect / PLATE_ASPECT;
  const z = OVERSCAN * (opts.zoom ?? 1);
  fx /= z;
  fy /= z;
  const pos = aspect <= 1 ? POSTER_POSITION.portrait : POSTER_POSITION.landscape;
  const ox = clamp(pos.x * (1 - fx) + (opts.panX ?? 0), 0, 1 - fx);
  const oy = clamp(pos.y * (1 - fy) + (opts.driftY ?? 0), 0, 1 - fy);
  return { sx: fx, sy: fy, ox, oy };
}

/** Screen position (0..1, top-left origin) of a plate point at a given depth. */
export function plateToScreen(cam: Pick<Camera, 'sx' | 'sy' | 'ox' | 'oy' | 'px' | 'py'>, x: number, y: number, depth: number) {
  const k = depth - 0.5;
  return {
    x: (x - cam.px * k - cam.ox) / cam.sx,
    y: (y - cam.py * k - cam.oy) / cam.sy,
  };
}

/** Plate position under a screen point (ignores parallax; good enough for pointer ripples). */
export function screenToPlate(view: View, sx: number, sy: number) {
  return { x: sx * view.sx + view.ox, y: sy * view.sy + view.oy };
}

/* ------------------------------------------------------------------ */
/* Tiny camera store: the player publishes every frame, hotspots read. */
/* ------------------------------------------------------------------ */

type Listener = (cam: Camera) => void;
const listeners = new Set<Listener>();
let current: Camera | null = null;

export function publishCamera(cam: Camera) {
  current = cam;
  listeners.forEach((l) => l(cam));
}

export function subscribeCamera(l: Listener): () => void {
  listeners.add(l);
  if (current) l(current);
  return () => {
    listeners.delete(l);
  };
}

/** True when the viewport uses the portrait crop (and so needs panning to reach every landmark). */
export function isPortrait(width: number, height: number) {
  return width / Math.max(1, height) <= 1;
}

/* Landmark focus: hotspot chips ask the camera to pan to a landmark (portrait). */
let focusX: number | null = null;
export function setPanFocus(x: number | null) {
  focusX = x;
}
export function getPanFocus() {
  return focusX;
}

/** Static camera for the poster tier (no parallax, no drift). */
export function staticCamera(width: number, height: number): Camera {
  return { ...coverView(width, height, { panX: focusPanX(width, height) }), px: 0, py: 0, dim: 0, width, height };
}

/** panX that centres the current focus landmark in a portrait crop (0 when there is none). */
export function focusPanX(width: number, height: number) {
  if (focusX == null || !isPortrait(width, height)) return 0;
  const base = coverView(width, height);
  return focusX - (base.ox + base.sx / 2);
}
