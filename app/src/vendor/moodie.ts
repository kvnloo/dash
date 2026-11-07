/**
 * Ported from kvnloo/synergy.ai companion-bot.js @ fd18f250d1680b33d51dc67daff64e887063f347.
 * Face geometry/expression table: Moodie — https://github.com/arhxam/moodie-react (MIT).
 * Liveliness (loop noise, blink curve, breath): https://github.com/jeremy-prt/bloub (MIT).
 * Copyright (c) 2026 Moodie contributors; Copyright (c) 2026 Jérémy Perret.
 * Data and arithmetic preserved; TypeScript exports and Reanimated worklet directives added.
 * The seeded 900-second blink schedule repeats for long-running app sessions.
 * Drag/pet gestures and page-specific mood/chat logic are deliberately not part of this port.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
export interface EyeGeometry { x: number; y: number; width: number; height: number; rotation: number; curve: number; skew: number; open: number }
export interface Expression { label: string; left: EyeGeometry; right: EyeGeometry; body?: { y?: number; rotate?: number; scaleX?: number; scaleY?: number }; reaction?: string }
const EYE_POINTS = 12;
const TAU = Math.PI * 2;
function clamp(value: number | undefined, min: number, max: number, fallback: number) {
  "worklet";
  return Math.max(min, Math.min(max, value ?? fallback));
}
function eye(x: number, y: number, width: number, height: number, rotation = 0, curve = 0.8, skew = 0, open = 1) {
  return { x, y, width, height, rotation, curve, skew, open };
}

/** Moodie presets + bloub emotion coverage, flat SVG geometry (MIT). */
export const EXPRESSIONS = {
  neutral: { label: "Neutral", left: eye(72, 94, 22, 42, -5), right: eye(128, 94, 22, 42, 5) },
  happy: { label: "Happy", left: eye(72, 100, 31, 13, 7, 0.38), right: eye(128, 100, 31, 13, -7, 0.38), body: { y: -2 }, reaction: "bounce" },
  excited: { label: "Excited", left: eye(70, 96, 29, 53, -9, 0.92), right: eye(130, 96, 29, 53, 9, 0.92), body: { scaleX: 1.03, scaleY: 0.97 }, reaction: "bounce" },
  sleepy: { label: "Sleepy", left: eye(72, 100, 28, 34, 2, 0.55, 0, 0.42), right: eye(128, 100, 28, 34, -2, 0.55, 0, 0.42), body: { rotate: -3, y: 4 }, reaction: "tilt" },
  worried: { label: "Worried", left: eye(72, 96, 22, 38, 16, 0.76), right: eye(128, 96, 22, 38, -16, 0.76), reaction: "tilt" },
  thinking: { label: "Thinking", left: eye(68, 91, 17, 30, -18, 0.88), right: eye(126, 101, 32, 15, -24, 0.46), body: { rotate: -4 }, reaction: "tilt" },
  curious: { label: "Curious", left: eye(70, 89, 18, 34, -12, 0.85), right: eye(130, 100, 31, 47, 10, 0.84), body: { rotate: 5 }, reaction: "tilt" },
  surprised: { label: "Surprised", left: eye(72, 95, 34, 52, 0, 1), right: eye(128, 95, 34, 52, 0, 1), body: { scaleX: 0.96, scaleY: 1.04 }, reaction: "bounce" },
  focused: { label: "Focused", left: eye(72, 97, 31, 13, 14, 0.4), right: eye(128, 97, 31, 13, -14, 0.4), body: { scaleX: 1.01 }, reaction: "squash" },
  cheeky: { label: "Cheeky", left: eye(72, 94, 28, 13, 10, 0.35), right: eye(128, 95, 21, 42, 8, 0.84), body: { rotate: 4 }, reaction: "tilt" },
  calm: { label: "Calm", left: eye(72, 99, 34, 9, 0, 0.3), right: eye(128, 99, 34, 9, 0, 0.3), body: { scaleX: 1.01, scaleY: 0.99 } },
  wink: { label: "Wink", left: eye(72, 99, 35, 8, 8, 0.25), right: eye(128, 95, 23, 43, 4, 0.85), body: { rotate: 3 }, reaction: "bounce" },
  alert: { label: "Alert", left: eye(72, 91, 21, 48, -3, 0.9), right: eye(128, 91, 21, 48, 3, 0.9), body: { y: -3, scaleY: 1.02 }, reaction: "bounce" },
  angry: { label: "Angry", left: eye(72, 97, 30, 14, 28, 0.4), right: eye(128, 97, 30, 14, -28, 0.4), body: { y: 1, scaleY: 0.98 }, reaction: "squash" },
  sad: { label: "Sad", left: eye(72, 100, 20, 36, -26, 0.78), right: eye(128, 100, 20, 36, 26, 0.78), body: { y: 3, rotate: -2 }, reaction: "tilt" },
  shy: { label: "Shy", left: eye(68, 98, 16, 28, -4, 0.8), right: eye(124, 98, 16, 28, 4, 0.8), body: { rotate: -6, y: 2 }, reaction: "tilt" },
  bored: { label: "Bored", left: eye(70, 99, 30, 11, 0, 0.28), right: eye(130, 99, 30, 11, 0, 0.28), body: { rotate: 2 }, reaction: "tilt" },
  proud: { label: "Proud", left: eye(72, 96, 28, 14, 16, 0.36), right: eye(128, 96, 28, 14, -16, 0.36), body: { y: -3, scaleY: 1.02 }, reaction: "bounce" },
  confused: { label: "Confused", left: eye(68, 92, 18, 40, -16, 0.85), right: eye(130, 100, 28, 14, 12, 0.4), body: { rotate: 7 }, reaction: "tilt" }
} satisfies Record<string, Expression>;

function round(n: number) {
  return Number(n.toFixed(3));
}

type Point = readonly [number, number];
function rotatePoint(x: number, y: number, degrees: number): Point {
  const rad = (degrees * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [x * c - y * s, x * s + y * c];
}

function createClosedPath(points: readonly Point[], tension = 1) {
  if (points.length < 3) return "";
  const safeTension = clamp(tension, 0, 2, 1);
  const first = points[0]!;
  let path = `M${round(first[0])},${round(first[1])}`;
  for (let i = 0; i < points.length; i += 1) {
    // The generated polygon has at least three points; every wrapped index is in bounds.
    const prev = points[(i - 1 + points.length) % points.length]!;
    const cur = points[i]!;
    const next = points[(i + 1) % points.length]!;
    const after = points[(i + 2) % points.length]!;
    const c1 = [
      round(cur[0] + ((next[0] - prev[0]) / 6) * safeTension),
      round(cur[1] + ((next[1] - prev[1]) / 6) * safeTension)
    ];
    const c2 = [
      round(next[0] - ((after[0] - cur[0]) / 6) * safeTension),
      round(next[1] - ((after[1] - cur[1]) / 6) * safeTension)
    ];
    path += `C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${round(next[0])},${round(next[1])}`;
  }
  return `${path}Z`;
}

function createEyePoints(geometry: Partial<EyeGeometry> = {}) {
  const centerX = clamp(geometry.x, -100, 300, 0);
  const centerY = clamp(geometry.y, -100, 300, 0);
  const width = clamp(geometry.width, 2, 120, 24);
  const height = clamp(geometry.height, 2, 120, 44);
  const rotation = clamp(geometry.rotation, -180, 180, 0);
  const curve = clamp(geometry.curve, 0, 1, 0.78);
  const skew = clamp(geometry.skew, -1, 1, 0);
  const exponent = 2 + curve * 2.4;
  return Array.from({ length: EYE_POINTS }, (_, index): Point => {
    const angle = (index / EYE_POINTS) * Math.PI * 2;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const localX =
      Math.sign(cosine || 1) * Math.pow(Math.abs(cosine), 2 / exponent) * (width / 2)
      + sine * skew * (height / 5);
    const localY =
      Math.sign(sine || 1) * Math.pow(Math.abs(sine), 2 / exponent) * (height / 2);
    const [rx, ry] = rotatePoint(localX, localY, rotation);
    return [round(centerX + rx), round(centerY + ry)];
  });
}

export function createEyePath(geometry: Partial<EyeGeometry> = {}) {
  const curve = clamp(geometry.curve, 0, 1, 0.78);
  return createClosedPath(createEyePoints(geometry), 0.82 + curve * 0.12);
}

export function createBlobBodyPath() {
  const points = Array.from({ length: 16 }, (_, index): Point => {
    const angle = (index / 16) * Math.PI * 2 - Math.PI / 2;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const unitX = Math.sign(cosine || 1) * Math.abs(cosine);
    const unitY = Math.sign(sine || 1) * Math.abs(sine);
    const wobble = 1 + Math.sin(angle * 3 + 0.7) * 0.045 + Math.cos(angle * 2 - 0.4) * 0.025;
    return [round(100 + unitX * 88 * wobble), round(100 + 2 + unitY * (88 / wobble))];
  });
  return createClosedPath(points, 1);
}

/** bloub loopNoise — seamless 1D wander for idle gaze. */
function loopNoise(t: number, period: number, seed = 0) {
  "worklet";
  const p = (t / period) * TAU;
  return (
    0.55 * Math.sin(p + seed)
    + 0.3 * Math.sin(2 * p + seed * 1.7 + 1.1)
    + 0.15 * Math.sin(3 * p + seed * 2.3 + 2.4)
  );
}

function createRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BLINK_RNG = createRng(0x5eed);
const BLINK_DUR = 0.18;
const BLINKS = (() => {
  const out = [];
  let t = 1.4;
  while (t < 900) {
    out.push(t);
    t += 1.9 + BLINK_RNG() * 2.7;
    if (BLINK_RNG() < 0.18) {
      out.push(t);
      t += 0.24;
    }
  }
  return out;
})();

/** bloub blinkLid: 1 open → 0 closed → 1 open over BLINK_DUR. */
function blinkLid(tSec: number) {
  "worklet";
  for (const start of BLINKS) {
    if (tSec < start) break;
    const k = (tSec - start) / BLINK_DUR;
    if (k >= 0 && k <= 1) {
      return k < 0.45 ? 1 - k / 0.45 : (k - 0.45) / 0.55;
    }
  }
  return 1;
}

export function lidToScale(lid: number) {
  "worklet";
  return 0.06 + 0.94 * clamp(lid, 0, 1, 1);
}

export function liveliness(tSec: number, { wander = 1, blink = true, float = true } = {}) {
  "worklet";
  return {
    dYaw: (loopNoise(tSec, 11.3, 0.4) * 5.5 + loopNoise(tSec, 3.7, 2.1) * 1.6) * wander,
    dPitch: (loopNoise(tSec, 9.1, 1.3) * 4.2 + loopNoise(tSec, 4.3, 0.7) * 1.3) * wander,
    dRoll: loopNoise(tSec, 13.7, 3.2) * 2.2 * wander,
    lid: blink ? blinkLid(tSec % 900) : 1,
    driftX: float ? loopNoise(tSec, 7.9, 1.9) * 0.006 : 0,
    driftY: float ? loopNoise(tSec, 5.3, 0.3) * 0.007 : 0,
    breath: float ? 1 + Math.sin((tSec / 3.4) * Math.PI * 2) * 0.005 : 1
  };
}

export type ExpressionName = keyof typeof EXPRESSIONS;
export const BLOB_BODY_PATH = createBlobBodyPath();
