import { colors, proofMono } from "../theme";
import type { OrbPhase } from "./orb-phase";

/**
 * One bot per Hermes profile (and one per non-Hermes harness), each with its own face.
 *
 * Inspired by how Grok Bot presents its roster (x.ai/news/designing-grok-bot): one consistent
 * construction with expressive eyes, told apart by controlled variations and accessories, and the
 * avatar itself carries the bot's state. Dash's construction is the dotted orb: a dark visor with
 * two lit eyes sits on the dot sphere. Nothing here copies Grok's artwork.
 *
 * Every field is drawn from a seeded stream over the profile name, so the same profile always gets
 * the same face on every device, with no stored state.
 */

/** How the head's dots are laid out. All are round, so in-plane spin never turns the silhouette. */
export type DotPattern = "fibonacci" | "rings" | "grid" | "spiral";
export type EyeStyle = "round" | "bar" | "tall" | "wide" | "single";
/** Static extras that make a bot recognisable at sidebar size. `satellite` orbits with the spin. */
export type Accessory = "none" | "antenna" | "halo" | "satellite" | "ears";
export type TintName = "ink" | "sky" | "sage" | "iris" | "teal";

export interface FaceVariant {
  pattern: DotPattern;
  /** Multiplier on the orb's size-based dot count. */
  density: number;
  eyes: EyeStyle;
  accessory: Accessory;
  tint: TintName;
  /** Eye and accessory colour: the tint softened toward ink. */
  eyeColor: string;
  /** Dot colour: ink with a trace of the tint, so the one-accent rule holds. */
  dotColor: string;
  /** 1 or -1: which way this bot's head turns while it works. */
  spinDir: 1 | -1;
  /** Multiplier on the phase's spin. */
  spinRate: number;
}

export interface BotIdentity {
  /** Stable key: `hermes:<profile>` or `harness:<id>`. */
  key: string;
  /** The profile (or harness) the face belongs to. */
  profile: string;
  name: string;
  descriptor?: string;
  face: FaceVariant;
}

export const DOT_PATTERNS: readonly DotPattern[] = ["fibonacci", "rings", "grid", "spiral"];
export const EYE_STYLES: readonly EyeStyle[] = ["round", "bar", "tall", "wide", "single"];
export const ACCESSORIES: readonly Accessory[] = ["none", "antenna", "halo", "satellite", "ears"];
export const TINT_NAMES: readonly TintName[] = ["ink", "sky", "sage", "iris", "teal"];
const DENSITIES = [0.8, 1, 1.25] as const;
const SPIN_RATES = [0.8, 1, 1.3] as const;

/** Curated tints. Gold stays reserved for actions and live state, so no bot wears it. */
const TINT_HEX: Record<TintName, string> = {
  ink: colors.text,
  sky: colors.information,
  sage: colors.ok,
  iris: colors.provenance,
  teal: colors.orchestraSubagent,
};

/** Short descriptors only where the profile name already says it; never invented. */
const DESCRIPTORS: Record<string, string> = {
  default: "Hermes home",
  chiefstaff: "chief of staff",
};

/** FNV-1a, 32-bit. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: a tiny deterministic stream, so adding a field later only appends draws. */
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(next: () => number, list: readonly T[]): T {
  const item = list[Math.floor(next() * list.length) % list.length];
  if (item === undefined) throw new Error("empty pick list");
  return item;
}

function hex(n: number): string {
  return Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
}

/** Linear sRGB-space mix of two #rrggbb colours: t=0 gives a, t=1 gives b. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(a);
  const pb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(b);
  if (!pa || !pb) return a;
  const ch = (i: 1 | 2 | 3) => parseInt(pa[i] ?? "0", 16) * (1 - t) + parseInt(pb[i] ?? "0", 16) * t;
  return `#${hex(ch(1))}${hex(ch(2))}${hex(ch(3))}`;
}

/** The face for one seed string. Pure: the same seed always yields the same face. */
export function faceFor(seed: string): FaceVariant {
  const next = stream(hash32(seed));
  const pattern = pick(next, DOT_PATTERNS);
  const density = pick(next, DENSITIES);
  const eyes = pick(next, EYE_STYLES);
  const accessory = pick(next, ACCESSORIES);
  const tint = pick(next, TINT_NAMES);
  const spinDir = next() < 0.5 ? 1 : -1;
  const spinRate = pick(next, SPIN_RATES);
  // Proof Mono must carry identity without hue: shape, eyes and accessory still differ.
  const tone = proofMono ? colors.text : TINT_HEX[tint];
  return {
    pattern, density, eyes, accessory, tint, spinDir, spinRate,
    eyeColor: mixHex(tone, colors.text, 0.3),
    dotColor: mixHex(colors.text, tone, 0.16),
  };
}

/** Visually salient signature: two bots that share it would read as the same face. */
export function faceSignature(face: FaceVariant): string {
  return `${face.pattern}/${face.eyes}/${face.accessory}/${face.tint}`;
}

/** Chosen so default, chiefstaff and clean differ in pattern, eyes, accessory and tint, and the ten
 * profiles on groot have distinct signatures. Changing it re-faces every bot; tests pin it. */
const SALT = "dash-bot/226";

export function hermesBotIdentity(profile: string | undefined): BotIdentity {
  const id = profile?.trim() || "default";
  const descriptor = DESCRIPTORS[id];
  return { key: `hermes:${id}`, profile: id, name: id, ...(descriptor ? { descriptor } : {}), face: faceFor(`${SALT}:hermes:${id}`) };
}

export function harnessBotIdentity(harness: string, name?: string): BotIdentity {
  return { key: `harness:${harness}`, profile: harness, name: name ?? harness, face: faceFor(`${SALT}:harness:${harness}`) };
}

/** The bot behind a chat: its Hermes profile, or the harness itself. */
export function chatBotIdentity(harness: string | undefined, profileId?: string, harnessName?: string): BotIdentity {
  if (!harness || harness === "hermes") return hermesBotIdentity(profileId);
  return harnessBotIdentity(harness, harnessName);
}

/**
 * The face's expression for a phase, in the orb's 64-unit viewBox.
 * gx/gy move the gaze, sy squints (1 open, 0 shut), scale widens the eyes, mouth talks.
 * At rest the bot is calm and a little curious; working, it looks down at the work;
 * thinking, it looks up and away; needing you, it looks straight at you, eyes wide.
 */
export interface FaceExpression { gx: number; gy: number; sy: number; scale: number; opacity: number; mouth: boolean }

export function faceExpression(phase: OrbPhase): FaceExpression {
  switch (phase) {
    case "idle": return { gx: 1.5, gy: -1, sy: 1, scale: 1, opacity: 0.85, mouth: false };
    case "listening": return { gx: 0, gy: -0.5, sy: 1, scale: 1.2, opacity: 1, mouth: false };
    case "thinking": return { gx: -2.5, gy: -2.5, sy: 0.7, scale: 0.95, opacity: 1, mouth: false };
    case "tool": return { gx: 0, gy: 2, sy: 0.45, scale: 1, opacity: 1, mouth: false };
    case "streaming": return { gx: 0, gy: 0, sy: 0.9, scale: 1, opacity: 1, mouth: true };
    case "speaking": return { gx: 0, gy: 0, sy: 0.9, scale: 1, opacity: 1, mouth: true };
    case "waiting-approval": return { gx: 0, gy: 0, sy: 1, scale: 1.25, opacity: 1, mouth: false };
    case "connecting": return { gx: 0, gy: 0, sy: 0.15, scale: 1, opacity: 0.6, mouth: false };
  }
}

export type Dot = { x: number; y: number; r: number; opacity: number };

/**
 * Dot layout for one pattern in the 64-unit viewBox, centred at (32,32) with radius `radius`.
 * Brightness and size follow a front-facing depth term so every pattern still reads as a sphere.
 */
export function faceDots(pattern: DotPattern, n: number, radius: number, dotScale = 1): Dot[] {
  const dot = (n >= 160 ? 0.4 : 0.55) * dotScale;
  const out: Dot[] = [];
  const push = (ux: number, uy: number, z: number) => {
    out.push({ x: 32 + ux * radius, y: 32 + uy * radius, r: dot + (z + 1) * 0.35, opacity: 0.2 + (z + 1) * 0.35 });
  };
  switch (pattern) {
    case "fibonacci":
    case "spiral": {
      // The golden angle spreads dots evenly; 2.2 rad leaves visible arms that read as a swirl.
      const step = pattern === "fibonacci" ? 2.3999632297 : 2.2;
      for (let i = 0; i < n; i += 1) {
        const y = 1 - 2 * (i + 0.5) / n;
        const r = Math.sqrt(1 - y * y);
        const a = i * step;
        push(Math.cos(a) * r, y, Math.sin(a) * r);
      }
      return out;
    }
    case "rings": {
      // Latitude rings: dots per ring follow its circumference.
      const rings = Math.max(4, Math.round(Math.sqrt(n / 2)));
      const per = n / rings;
      for (let k = 0; k < rings; k += 1) {
        const y = -1 + 2 * (k + 0.5) / rings;
        const r = Math.sqrt(1 - y * y);
        const count = Math.max(3, Math.round(per * r * 1.25));
        for (let j = 0; j < count; j += 1) {
          const a = (j + (k % 2) * 0.5) / count * Math.PI * 2;
          push(Math.cos(a) * r, y, Math.sin(a) * r);
        }
      }
      return out;
    }
    case "grid": {
      // An LED matrix clipped to the disc, shaded as if wrapped on a sphere.
      const side = Math.max(5, Math.round(Math.sqrt(n * 4 / Math.PI)));
      for (let gy = 0; gy < side; gy += 1) {
        for (let gx = 0; gx < side; gx += 1) {
          const ux = -1 + 2 * (gx + 0.5) / side;
          const uy = -1 + 2 * (gy + 0.5) / side;
          const d = ux * ux + uy * uy;
          if (d > 0.98) continue;
          push(ux, uy, Math.sqrt(1 - d) * 2 - 1);
        }
      }
      return out;
    }
  }
}
