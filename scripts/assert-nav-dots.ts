#!/usr/bin/env bun
/**
 * Device-layer catch for AppNav dots collapsing to the top of the gold pill.
 *
 * Unit tests pin StyleSheet numbers. This checker looks at pixels (Maestro
 * screenshot or a synthetic fixture) so CI fails on the Yoga-layout class of
 * bug mutation testing covers in source.
 *
 *   bun scripts/assert-nav-dots.ts artifacts/verify-dash/maestro-nav-chrome.png
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";
import {
  NAV_DOT_SIZE,
  NAV_PILL_HEIGHT,
  NAV_SLOT_WIDTH,
} from "../app/src/components/golden-nav";

export const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

export type RgbaImage = { width: number; height: number; data: Uint8Array };

export type Rect = { x: number; y: number; w: number; h: number };
export type Dot = { cx: number; cy: number; w: number; h: number };

export type NavDotOk = { ok: true; pill: Rect; dots: [Dot, Dot, Dot]; scale: number };
export type NavDotFail = { ok: false; reason: string };
export type NavDotResult = NavDotOk | NavDotFail;

const GOLD: readonly [number, number, number] = [0xd7, 0xb9, 0x86];
const DOT_ON: readonly [number, number, number] = [0x21, 0x1b, 0x10];
const DOT_OFF: readonly [number, number, number] = [0x83, 0x7f, 0x74];

function manhattan(r: number, g: number, b: number, t: readonly number[]): number {
  return Math.abs(r - (t[0] ?? 0)) + Math.abs(g - (t[1] ?? 0)) + Math.abs(b - (t[2] ?? 0));
}

function isGold(r: number, g: number, b: number): boolean {
  return manhattan(r, g, b, GOLD) <= 90 && r >= 120 && r > b + 20;
}

function isPager(r: number, g: number, b: number): boolean {
  return r < 22 && g < 22 && b < 22;
}

function isDotColor(r: number, g: number, b: number): boolean {
  if (isGold(r, g, b) || isPager(r, g, b)) return false;
  return manhattan(r, g, b, DOT_ON) <= 36 || manhattan(r, g, b, DOT_OFF) <= 55;
}

function pixel(img: RgbaImage, x: number, y: number): readonly [number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0];
}

type Blob = { minX: number; minY: number; maxX: number; maxY: number; count: number };

function goldRect(img: RgbaImage): Rect | null {
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const [r, g, b] = pixel(img, x, y);
      if (!isGold(r, g, b)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function blobs(img: RgbaImage, pred: (r: number, g: number, b: number) => boolean): Blob[] {
  const seen = new Uint8Array(img.width * img.height);
  const out: Blob[] = [];
  const stack: number[] = [];
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const start = y * img.width + x;
      if (seen[start]) continue;
      const [r0, g0, b0] = pixel(img, x, y);
      if (!pred(r0, g0, b0)) continue;
      seen[start] = 1;
      stack.length = 0;
      stack.push(start);
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let count = 0;
      while (stack.length) {
        const idx = stack.pop();
        if (idx == null) break;
        const px = idx % img.width;
        const py = (idx - px) / img.width;
        count++;
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
        const neighbors = [idx - 1, idx + 1, idx - img.width, idx + img.width];
        for (const n of neighbors) {
          if (n < 0 || n >= seen.length || seen[n]) continue;
          const nx = n % img.width;
          const ny = (n - nx) / img.width;
          if (Math.abs(nx - px) + Math.abs(ny - py) !== 1) continue;
          const [r, g, b] = pixel(img, nx, ny);
          if (!pred(r, g, b)) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      out.push({ minX, minY, maxX, maxY, count });
    }
  }
  return out;
}

function toDot(b: Blob): Dot {
  return {
    cx: (b.minX + b.maxX + 1) / 2,
    cy: (b.minY + b.maxY + 1) / 2,
    w: b.maxX - b.minX + 1,
    h: b.maxY - b.minY + 1,
  };
}

export function checkNavDots(img: RgbaImage): NavDotResult {
  const pill = goldRect(img);
  if (!pill) return { ok: false, reason: "no gold pill in screenshot" };
  if (pill.h < NAV_DOT_SIZE * 2) {
    return { ok: false, reason: `gold pill too short (${pill.h}px)` };
  }
  const scale = pill.h / NAV_PILL_HEIGHT;
  const minSide = Math.max(2, NAV_DOT_SIZE * scale * 0.4);
  const maxSide = Math.max(8, NAV_DOT_SIZE * scale * 3);
  const minArea = minSide * minSide;
  const maxArea = maxSide * maxSide;
  const candidates = blobs(img, isDotColor)
    .filter((b) => {
      const w = b.maxX - b.minX + 1;
      const h = b.maxY - b.minY + 1;
      return w >= minSide && h >= minSide && w <= maxSide && h <= maxSide && b.count >= minArea && b.count <= maxArea;
    })
    .sort((a, b) => b.count - a.count);

  if (candidates.length < 3) {
    return { ok: false, reason: `expected 3 dots, got ${candidates.length}` };
  }
  const chosen = candidates.slice(0, 3).map(toDot).sort((a, b) => a.cx - b.cx);
  const a = chosen[0];
  const b = chosen[1];
  const c = chosen[2];
  if (!a || !b || !c) return { ok: false, reason: "expected 3 dots" };
  const dots: [Dot, Dot, Dot] = [a, b, c];

  const pillCy = pill.y + pill.h / 2;
  const vTol = Math.max(1.5, 2 * scale);
  for (const dot of dots) {
    const err = Math.abs(dot.cy - pillCy);
    if (err > vTol) {
      return {
        ok: false,
        reason: `dots not vertically centered in gold pill (dot cy=${dot.cy.toFixed(1)} pill cy=${pillCy.toFixed(1)} err=${err.toFixed(1)}px)`,
      };
    }
  }

  const gap0 = b.cx - a.cx;
  const gap1 = c.cx - b.cx;
  const hTol = Math.max(2, 2 * scale);
  if (Math.abs(gap0 - gap1) > hTol) {
    return {
      ok: false,
      reason: `dots not evenly spaced horizontally (gaps ${gap0.toFixed(1)}px, ${gap1.toFixed(1)}px)`,
    };
  }
  const expected = NAV_SLOT_WIDTH * scale;
  const mean = (gap0 + gap1) / 2;
  if (Math.abs(mean - expected) > Math.max(3, 0.2 * expected)) {
    return {
      ok: false,
      reason: `dots not evenly spaced horizontally (mean gap ${mean.toFixed(1)}px, expected ${expected.toFixed(1)}px slot)`,
    };
  }
  return { ok: true, pill, dots, scale };
}

export function requireNavDots(img: RgbaImage): NavDotOk {
  const result = checkNavDots(img);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const crc = crc32(concat([typeBytes, data]));
  return concat([u32be(data.length), typeBytes, data, u32be(crc)]);
}

export function encodePng(img: RgbaImage): Uint8Array {
  const raw = new Uint8Array(img.height * (1 + img.width * 4));
  for (let y = 0; y < img.height; y++) {
    const row = y * (1 + img.width * 4);
    raw[row] = 0;
    raw.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), row + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, img.width);
  view.setUint32(4, img.height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return concat([PNG_SIG, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function recon(filter: number, filt: Uint8Array, reconRow: Uint8Array, prev: Uint8Array, bpp: number): void {
  for (let i = 0; i < reconRow.length; i++) {
    const a = i >= bpp ? (reconRow[i - bpp] ?? 0) : 0;
    const b = prev[i] ?? 0;
    const c = i >= bpp ? (prev[i - bpp] ?? 0) : 0;
    const x = filt[i] ?? 0;
    let v = x;
    if (filter === 1) v = x + a;
    else if (filter === 2) v = x + b;
    else if (filter === 3) v = x + ((a + b) >> 1);
    else if (filter === 4) v = x + paeth(a, b, c);
    else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
    reconRow[i] = v & 255;
  }
}

export function decodePng(bytes: Uint8Array): RgbaImage {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIG[i]) throw new Error("not a PNG");
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];
  let o = 8;
  while (o + 12 <= bytes.length) {
    const len = new DataView(bytes.buffer, bytes.byteOffset + o, 4).getUint32(0);
    const type = String.fromCharCode(bytes[o + 4] ?? 0, bytes[o + 5] ?? 0, bytes[o + 6] ?? 0, bytes[o + 7] ?? 0);
    const data = bytes.subarray(o + 8, o + 8 + len);
    o += 12 + len;
    if (type === "IHDR") {
      const v = new DataView(data.buffer, data.byteOffset, data.length);
      width = v.getUint32(0);
      height = v.getUint32(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (!width || !height) throw new Error("PNG missing IHDR");
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG color type ${colorType}/${bitDepth}`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const inflated = inflateSync(concat(idat));
  const stride = width * bpp;
  const rgba = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const reconRow = new Uint8Array(stride);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[src] ?? 0;
    const filt = inflated.subarray(src + 1, src + 1 + stride);
    src += 1 + stride;
    recon(filter, filt, reconRow, prev, bpp);
    prev.set(reconRow);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = reconRow[x * bpp] ?? 0;
      rgba[i + 1] = reconRow[x * bpp + 1] ?? 0;
      rgba[i + 2] = reconRow[x * bpp + 2] ?? 0;
      rgba[i + 3] = bpp === 4 ? (reconRow[x * bpp + 3] ?? 255) : 255;
    }
  }
  return { width, height, data: rgba };
}

export function checkNavDotsPng(bytes: Uint8Array): NavDotResult {
  return checkNavDots(decodePng(bytes));
}

async function main(argv: string[]): Promise<void> {
  const path = argv[0];
  if (!path) {
    console.error("usage: bun scripts/assert-nav-dots.ts <screenshot.png>");
    process.exit(2);
  }
  const file = path.startsWith("/") ? path : join(process.cwd(), path);
  const bytes = new Uint8Array(readFileSync(file));
  const result = requireNavDots(decodePng(bytes));
  console.log(
    `nav dots centered: 3 dots, scale=${result.scale.toFixed(2)}, pill ${result.pill.w}x${result.pill.h}`,
  );
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
