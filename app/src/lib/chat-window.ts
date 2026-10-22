/**
 * Chat window geometry and labels: pure functions so the UI-thread morph, pill bounds and
 * identity truncation are pinned by unit and mutation tests. See docs/chat-window.md.
 */

export interface Rect { x: number; y: number; width: number; height: number }
/** Source row of the list, window coordinates. Only what the morph needs. */
export interface WindowOrigin { y: number; height: number }

export const PILL_HEIGHT = 28;
export const PILL_HIT = 44;
export const PILL_GAP = 4;
export const PILL_MAX_FRACTION = 0.56;
export const PILL_MAX_WIDTH = 260;
/** Room for a short label on each side of a cut-out. */
export const PILL_LABEL_SLOT = 72;
export const CLOSE_GLYPH = 24;
export const CLOSE_HIT = 44;
export const MORPH_SCALE_FROM = 0.94;

export interface PillGeometry {
  mode: "cutout" | "safe-area";
  left: number;
  top: number;
  width: number;
  height: number;
  /** Transparent gap over the hardware hole, pill-local x. Null in safe-area mode. */
  hole: { left: number; width: number } | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Pill placement. A known top cut-out (native DisplayCutout rect) is wrapped; anything else
 * (no rect, a side/bottom cut-out, a rect outside the window) gets an ordinary safe-area pill.
 */
export function pillGeometry({ insetTop, width, cutout }: { insetTop: number; width: number; cutout?: Rect | null }): PillGeometry {
  const maxWidth = Math.min(width * PILL_MAX_FRACTION, PILL_MAX_WIDTH);
  const usable = cutout && cutout.width > 0 && cutout.height > 0 && cutout.y >= 0 && cutout.y < insetTop + PILL_HEIGHT
    && cutout.x >= 0 && cutout.x + cutout.width <= width;
  if (!usable) {
    const pillWidth = Math.max(0, maxWidth);
    return { mode: "safe-area", left: (width - pillWidth) / 2, top: insetTop + PILL_GAP, width: pillWidth, height: PILL_HEIGHT, hole: null };
  }
  const height = Math.max(PILL_HEIGHT, cutout.height + 2 * PILL_GAP);
  const top = Math.max(0, cutout.y + cutout.height / 2 - height / 2);
  const pillWidth = Math.min(Math.max(maxWidth, cutout.width + 2 * PILL_LABEL_SLOT), width);
  const centre = cutout.x + cutout.width / 2;
  const left = clamp(centre - pillWidth / 2, 0, width - pillWidth);
  return { mode: "cutout", left, top, width: pillWidth, height, hole: { left: cutout.x - left - PILL_GAP, width: cutout.width + 2 * PILL_GAP } };
}

/** Space the window reserves above the transcript so content never sits under the pill. */
export function pillReserve(geometry: PillGeometry): number {
  return geometry.top + geometry.height + PILL_GAP;
}

/** Start transform for the open morph; the window is laid out at its final size. */
export function morphFrom(origin: WindowOrigin | undefined, windowHeight: number): { translateY: number; scale: number } {
  if (!origin || windowHeight <= 0) return { translateY: 0, scale: MORPH_SCALE_FROM };
  const delta = origin.y + origin.height / 2 - windowHeight / 2;
  return { translateY: clamp(delta, -windowHeight / 2, windowHeight / 2), scale: MORPH_SCALE_FROM };
}

export type WindowLayer = "menu" | "tree" | "nav" | "window";
/** Android Back closes the most transient layer first; the window last. */
export function backTarget(state: { menuOpen: boolean; treeOpen: boolean; navOpen: boolean }): WindowLayer {
  if (state.menuOpen) return "menu";
  if (state.treeOpen) return "tree";
  if (state.navOpen) return "nav";
  return "window";
}

export interface IdentityInput {
  hostName?: string;
  harnessName: string;
  profile?: string;
  sessionId?: string;
  /** Host-reported model for this session. The protocol has none yet: always undefined. */
  model?: string;
}

export const MODEL_UNKNOWN = "model unknown";

export function shortSession(id: string | undefined): string | undefined {
  return id ? id.slice(0, 8) : undefined;
}

function tail(text: string, keep: number): string {
  return text.length <= keep + 1 ? text : `${text.slice(0, keep)}…`;
}

function middle(text: string, keep: number): string {
  if (text.length <= keep + 1) return text;
  const head = Math.ceil(keep / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}

/**
 * Collapsed badge for a character budget per line. Line 1 is who/where; line 2 is the model, so
 * `model unknown` is never squeezed out by names. Line 1 drop order: host, then harness, then the
 * profile tail-truncates to 6 characters. Session8 always stays. The model middle-truncates last.
 */
export function identityLines(input: IdentityInput, budget: number): { who: string; model: string } {
  const model = input.model ?? MODEL_UNKNOWN;
  const session = shortSession(input.sessionId) ?? "new chat";
  const profile = input.profile ?? input.harnessName;
  const distinct = profile === input.harnessName ? undefined : profile;
  const join = (parts: (string | undefined)[]) => parts.filter((p): p is string => Boolean(p)).join(" · ");
  const candidates = [
    join([input.hostName, input.harnessName, distinct, session]),
    join([input.harnessName, distinct, session]),
    join([profile, session]),
  ];
  const who = candidates.find(text => text.length <= budget) ?? join([tail(profile, 6), session]);
  return { who, model: model.length <= budget ? model : middle(model, Math.max(6, budget - 1)) };
}

export function identityLabel(input: IdentityInput): string {
  return `Chat identity: host ${input.hostName ?? "unknown"}, harness ${input.harnessName}, profile ${input.profile ?? "none"}, session ${input.sessionId ?? "not attached yet"}, ${input.model ? `model ${input.model}` : "model unknown, host has not reported it"}. Double-tap for details.`;
}

export interface PillStatusInput {
  online: boolean;
  phase: "idle" | "thinking" | "tool" | "writing" | string;
  tool?: string;
  voicePhase?: string;
  queued: number;
}

/** What the pill says. Only observed facts; idle says nothing beyond the title. */
export function pillStatus(input: PillStatusInput): string[] {
  const parts: string[] = [];
  if (!input.online) parts.push("offline");
  else if (input.phase === "tool") parts.push(input.tool ? `running ${input.tool}` : "running tool");
  else if (input.phase !== "idle") parts.push("working");
  if (input.voicePhase) parts.push(`voice ${input.voicePhase}`);
  if (input.queued > 0) parts.push(`${input.queued} queued`);
  return parts;
}

/** Explicit current-vs-switch wording for the Surface row; never a bare highlighted chip. */
export function surfaceValue(live: boolean): string {
  return live ? "Current: Live surface · switch to Chat" : "Current: Chat · switch to Live surface";
}
