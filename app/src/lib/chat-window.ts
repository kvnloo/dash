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
/** Room for a short label on each side of a cut-out: one orb/glyph plus a 12-character status. */
export const PILL_LABEL_SLOT = 112;
export const CLOSE_GLYPH = 24;
export const CLOSE_HIT = 44;
export const MORPH_SCALE_FROM = 0.94;

export interface PillGeometry {
  mode: "cutout" | "safe-area";
  left: number;
  top: number;
  width: number;
  height: number;
  /** Transparent gap over the hardware rect, in pill-local DIP. Null in safe-area mode. */
  hole: { left: number; top: number; width: number; height: number } | null;
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
  const top = cutout.y + cutout.height / 2 - height / 2;
  const centre = cutout.x + cutout.width / 2;
  // Shrink symmetrically near a screen edge; clamping left would move the pill off the lens.
  const pillWidth = Math.min(Math.max(maxWidth, cutout.width + 2 * PILL_LABEL_SLOT), 2 * Math.min(centre, width - centre));
  const left = centre - pillWidth / 2;
  return { mode: "cutout", left, top, width: pillWidth, height, hole: {
    left: cutout.x - left - PILL_GAP, top: cutout.y - top - PILL_GAP,
    width: cutout.width + 2 * PILL_GAP, height: cutout.height + 2 * PILL_GAP,
  } };
}

/** A rounded rect, not a width-derived circle: Android's bounding rect need not be square. */
export function pillLensPath(hole: PillGeometry["hole"]): string {
  if (!hole) return "";
  const r = Math.min(hole.width, hole.height) / 2;
  const left = hole.left, right = left + hole.width, top = hole.top, bottom = top + hole.height;
  return `M${left + r} ${top}H${right - r}A${r} ${r} 0 0 1 ${right} ${top + r}V${bottom - r}A${r} ${r} 0 0 1 ${right - r} ${bottom}H${left + r}A${r} ${r} 0 0 1 ${left} ${bottom - r}V${top + r}A${r} ${r} 0 0 1 ${left + r} ${top}Z`;
}

/**
 * Space the window reserves above the transcript so content never sits under the pill, and
 * never above the status-bar inset (system icons beside the cut-out stay unobstructed).
 */
export function pillReserve(geometry: PillGeometry, insetTop = 0): number {
  return Math.max(insetTop, geometry.top + geometry.height + PILL_GAP);
}

/** What the native DisplayCutout provider reports, already in DIP (converted once natively). */
export interface CutoutReading {
  supported: boolean;
  rects: Rect[];
  windowWidth: number;
  windowHeight: number;
  safeInsetTop: number;
  rotation: number;
}

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function obj(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

/** Boundary parser for the native module's map. Anything malformed means "no reading". */
export function parseCutout(value: unknown): CutoutReading | null {
  if (!obj(value) || value.supported !== true || !Array.isArray(value.rects)) return null;
  if (!finite(value.windowWidth) || !finite(value.windowHeight) || !finite(value.safeInsetTop) || !finite(value.rotation)) return null;
  const rects: Rect[] = [];
  for (const r of value.rects) {
    if (!obj(r) || !finite(r.x) || !finite(r.y) || !finite(r.width) || !finite(r.height)) return null;
    rects.push({ x: r.x, y: r.y, width: r.width, height: r.height });
  }
  return { supported: true, rects, windowWidth: value.windowWidth, windowHeight: value.windowHeight, safeInsetTop: value.safeInsetTop, rotation: value.rotation };
}

/**
 * The cut-out to wrap: the top-band rect of a reading taken for this window size. A reading for
 * another size (rotation in flight, split screen, stale) is ignored rather than mis-placed.
 */
export function topCutout(reading: CutoutReading | null, window: { width: number; height?: number; insetTop: number }): Rect | null {
  if (!reading || Math.abs(reading.windowWidth - window.width) > 2
    || (window.height !== undefined && Math.abs(reading.windowHeight - window.height) > 2)) return null;
  const band = Math.max(window.insetTop, reading.safeInsetTop) + PILL_HEIGHT;
  const top = reading.rects.filter(r => r.y < band && r.y + r.height <= band + PILL_HEIGHT).sort((a, b) => a.y - b.y)[0];
  return top ?? null;
}

/** Start transform for the open morph; the window is laid out at its final size. */
export function morphFrom(origin: WindowOrigin | undefined, windowHeight: number): { translateY: number; scale: number } {
  if (!origin || windowHeight <= 0) return { translateY: 0, scale: MORPH_SCALE_FROM };
  const delta = origin.y + origin.height / 2 - windowHeight / 2;
  return { translateY: clamp(delta, -windowHeight / 2, windowHeight / 2), scale: MORPH_SCALE_FROM };
}

/** One frame of the open/close morph. Reduce motion drops travel and scale and keeps the crossfade. */
export function morphFrame(progress: number, from: { translateY: number; scale: number }, reduced: boolean) {
  "worklet";
  if (reduced) return { opacity: progress, transform: [{ translateY: 0 }, { scale: 1 }] };
  return {
    opacity: progress,
    transform: [
      { translateY: from.translateY * (1 - progress) },
      { scale: from.scale + (1 - from.scale) * progress },
    ],
  };
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
  /** Host-reported model for this exact session (Hermes state.db `sessions.model`), else unknown. */
  model?: string;
  /** Host-recorded effective runtime provider for the session, when reported. */
  provider?: string;
  /** Parent session (compaction/delegation lineage), when reported. */
  parentSessionId?: string;
  /** The host continued this chat in a compaction child; the reading is for that child. */
  continuedAs?: string;
  /** When the host reading was received (ms epoch). */
  observedAt?: number;
}

/** Minimal shape of the host's exact-session context reading (shared/context ContextSnapshot). */
export interface HostSessionReading { sessionId: string; model: string; provider?: string; parentSessionId?: string }

/**
 * Bind a host reading to the attached session. Only the same session, or its compaction
 * continuation (child whose parent is the attached session), may label this chat.
 */
export function hostIdentity(reading: HostSessionReading | undefined, attached: string | undefined, observedAt?: number): Pick<IdentityInput, "model" | "provider" | "parentSessionId" | "continuedAs" | "observedAt"> {
  if (!reading || !attached) return {};
  const same = reading.sessionId === attached;
  const continued = !same && reading.parentSessionId === attached;
  if (!same && !continued) return {};
  return {
    ...(reading.model ? { model: reading.model } : {}),
    ...(reading.provider ? { provider: reading.provider } : {}),
    ...(reading.parentSessionId ? { parentSessionId: reading.parentSessionId } : {}),
    ...(continued ? { continuedAs: reading.sessionId } : {}),
    ...(observedAt !== undefined ? { observedAt } : {}),
  };
}

export const MODEL_UNKNOWN = "model unknown";

export function shortSession(id: string | undefined): string | undefined {
  return id ? id.slice(0, 8) : undefined;
}

function tail(text: string, keep: number): string {
  return text.length <= keep + 1 ? text : `${text.slice(0, keep)}…`;
}

/** Keep `keep` characters of `text`, half from each end, with an ellipsis between them. */
export function middleTruncate(text: string, keep: number): string {
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
  const full = input.model ? (input.provider ? `${input.provider} · ${input.model}` : input.model) : MODEL_UNKNOWN;
  // Narrow: drop the provider before cutting the model name (the a11y label keeps both).
  const model = full.length <= budget || !input.model ? full : input.model;
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
  return { who, model: model.length <= budget ? model : middleTruncate(model, Math.max(6, budget - 1)) };
}

/** A session id is never shown wider than this, however much room there is: the ends identify it. */
export const SESSION_ID_CHARS = 24;

/** One line for a session id: middle-truncated so its recognisable prefix and its distinguishing tail both survive. */
export function sessionIdLabel(id: string, budget: number): string {
  return middleTruncate(id, Math.max(8, Math.min(budget, SESSION_ID_CHARS)));
}

export function identityLabel(input: IdentityInput): string {
  return `Chat identity: host ${input.hostName ?? "unknown"}, harness ${input.harnessName}, profile ${input.profile ?? "none"}, session ${input.sessionId ?? "not attached yet"}, ${input.model ? `model ${input.provider ? `${input.provider} ` : ""}${input.model}, reported by host` : "model unknown, host has not reported it"}. Double-tap for details.`;
}

export interface PillStatusInput {
  online: boolean;
  phase: "idle" | "thinking" | "tool" | "writing" | string;
  tool?: string;
  voicePhase?: string;
  queued: number;
}

/** Navigation status only; live turn activity belongs to the transcript. */
export function pillStatus(input: PillStatusInput): string[] {
  const parts: string[] = [];
  if (!input.online) parts.push("offline");
  if (input.voicePhase) parts.push(`voice ${input.voicePhase}`);
  if (input.queued > 0) parts.push(`${input.queued} queued`);
  return parts;
}

/** Longest status text the pill's reserved slot shows unclipped (glyph + 12 mono characters). */
export const STATUS_CHARS = 12;
export type PillGlyph = "wifi-off" | "mic" | "tool" | "activity" | "layers";
/**
 * The one status the pill shows next to the title. Its slot is reserved, so the title truncates
 * first. Priority: offline, live voice, queued. Turn activity stays in the transcript.
 */
export function pillPrimary(input: PillStatusInput): { glyph: PillGlyph; text: string } | null {
  const fit = (text: string) => tail(text, STATUS_CHARS - 1);
  if (!input.online) return { glyph: "wifi-off", text: "offline" };
  if (input.voicePhase) return { glyph: "mic", text: fit(input.voicePhase) };
  if (input.queued > 0) return { glyph: "layers", text: fit(`${input.queued} queued`) };
  return null;
}

/** Explicit current-vs-switch wording for the Surface row; never a bare highlighted chip. */
export function surfaceValue(live: boolean): string {
  return live ? "Current: Live surface · switch to Chat" : "Current: Chat · switch to Live surface";
}
