/**
 * Pure layout geometry for Flow's Brainstorm surface.
 *
 * All rectangles use screen-relative, integer DIP. The keyboard height is the
 * obscured bottom portion of the screen (not an additional safe-area inset).
 * The pill deliberately overlays the visual pane; it never overlays transcript
 * or composer. Inputs too small to contain the required pill are rejected.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrainstormLayoutInput {
  width: number;
  height: number;
  safeTop: number;
  safeBottom: number;
  keyboardHeight: number;
  composerHeight: number;
  transcriptMinHeight?: number;
  visualRatio?: number;
  pill?: number;
}

export interface BrainstormLayout {
  orientation: "portrait" | "landscape";
  visual: Rect;
  transcript: Rect;
  composer: Rect;
  pill: Rect;
  /** The transcript is shorter than transcriptMinHeight. */
  cramped: boolean;
}

/**
 * Floor screen dimensions so an integer rect never extends beyond a fractional
 * screen edge. Ceil reservations so they do not intrude into a safe/IME region.
 */
function dip(value: number, name: string, rounding: "floor" | "ceil"): number {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(name + " must be a finite nonnegative DIP");
  }
  const rounded = rounding === "floor" ? Math.floor(value) : Math.ceil(value);
  if (!Number.isSafeInteger(rounded)) {
    throw new RangeError(name + " is outside the supported DIP range");
  }
  return rounded;
}

/** An 8-DIP inset when there is room, otherwise flush to the visual edge. */
function visualPill(visual: Rect, size: number): Rect {
  return {
    x: visual.x + Math.max(0, visual.width - size - 8),
    y: visual.y + Math.min(8, visual.height - size),
    width: size,
    height: size,
  };
}

export function computeBrainstormLayout({
  width,
  height,
  safeTop,
  safeBottom,
  keyboardHeight,
  composerHeight,
  transcriptMinHeight = 88,
  visualRatio = 0.6,
  pill = 44,
}: BrainstormLayoutInput): BrainstormLayout {
  const screenWidth = dip(width, "width", "floor");
  const screenHeight = dip(height, "height", "floor");
  const top = dip(safeTop, "safeTop", "ceil");
  const bottom = dip(safeBottom, "safeBottom", "ceil");
  const keyboard = dip(keyboardHeight, "keyboardHeight", "ceil");
  const composerSize = dip(composerHeight, "composerHeight", "ceil");
  const transcriptMinimum = dip(transcriptMinHeight, "transcriptMinHeight", "ceil");
  const pillSize = dip(pill, "pill", "ceil");

  if (!Number.isFinite(visualRatio) || visualRatio <= 0 || visualRatio >= 1) {
    throw new RangeError("visualRatio must be strictly between zero and one");
  }
  if (pillSize < 44) {
    throw new RangeError("pill must preserve a 44-DIP touch target");
  }

  const usable = screenHeight - top - bottom - keyboard;
  if (screenWidth < pillSize || usable < pillSize || composerSize > usable) {
    throw new RangeError("Not enough visible screen for Brainstorm geometry");
  }

  const orientation = screenWidth > screenHeight ? "landscape" : "portrait";
  let visual: Rect;
  let transcript: Rect;
  let composer: Rect;
  let cramped: boolean;

  if (orientation === "landscape") {
    // Reserve a complete touch target in both columns. A zero-width right
    // column is not a usable transcript/composer surface.
    if (screenWidth < pillSize * 2) {
      throw new RangeError("Landscape requires two visible columns");
    }
    const visualWidth = Math.max(
      pillSize,
      Math.min(screenWidth - pillSize, Math.round(screenWidth * visualRatio)),
    );
    const rightX = visualWidth;
    const rightWidth = screenWidth - visualWidth;
    const transcriptHeight = usable - composerSize;

    visual = { x: 0, y: top, width: visualWidth, height: usable };
    transcript = { x: rightX, y: top, width: rightWidth, height: transcriptHeight };
    composer = {
      x: rightX,
      y: top + transcriptHeight,
      width: rightWidth,
      height: composerSize,
    };
    cramped = transcriptHeight < transcriptMinimum;
  } else {
    const freeAboveComposer = usable - composerSize;
    // In a cramped portrait the visual still owns 30% of *usable*, not
    // merely 30% of the portion left after reserving the composer.
    const minVisual = Math.max(pillSize, Math.ceil(usable * 0.3));
    if (freeAboveComposer < minVisual) {
      throw new RangeError("Composer leaves no room for the visual pill");
    }

    cramped = freeAboveComposer - minVisual < transcriptMinimum;
    const visualHeight = cramped
      ? minVisual
      : Math.max(
        pillSize,
        Math.min(Math.round(usable * visualRatio), freeAboveComposer - transcriptMinimum),
      );
    const transcriptHeight = freeAboveComposer - visualHeight;

    visual = { x: 0, y: top, width: screenWidth, height: visualHeight };
    transcript = {
      x: 0,
      y: top + visualHeight,
      width: screenWidth,
      height: transcriptHeight,
    };
    composer = {
      x: 0,
      y: top + visualHeight + transcriptHeight,
      width: screenWidth,
      height: composerSize,
    };
  }

  return {
    orientation,
    visual,
    transcript,
    composer,
    pill: visualPill(visual, pillSize),
    cramped,
  };
}
