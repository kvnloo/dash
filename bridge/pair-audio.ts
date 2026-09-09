import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { codeCharIndex } from "./pair";

const SAMPLE_RATE = 44100;
const TONE_MS = 400;
const GAP_MS = 200;
const BASE_HZ = 880;
const STEP_HZ = 55;

function pcmTone(freq: number, ms: number): Int16Array {
  const n = Math.floor((SAMPLE_RATE * ms) / 1000);
  const buf = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.min(1, i / 800, (n - i) / 800);
    buf[i] = Math.floor(Math.sin(2 * Math.PI * freq * t) * 12000 * env);
  }
  return buf;
}

function pcmSilence(ms: number): Int16Array {
  return new Int16Array(Math.floor((SAMPLE_RATE * ms) / 1000));
}

function charHz(ch: string): number | null {
  const idx = codeCharIndex(ch);
  if (idx < 0) return null;
  return BASE_HZ + idx * STEP_HZ;
}

function writeWav(path: string, samples: Int16Array): void {
  const dataSize = samples.length * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  const body = Buffer.alloc(dataSize);
  for (let i = 0; i < samples.length; i++) body.writeInt16LE(samples[i] ?? 0, i * 2);
  writeFileSync(path, Buffer.concat([header, body]));
}

export function playPairCode(code: string): void {
  const chunks: Int16Array[] = [];
  for (const ch of code) {
    const hz = charHz(ch);
    if (hz === null) continue;
    chunks.push(pcmTone(hz, TONE_MS), pcmSilence(GAP_MS));
  }
  if (chunks.length === 0) return;
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Int16Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  const path = join(tmpdir(), `dash-pair-${process.pid}.wav`);
  writeWav(path, merged);
  if (Bun.which("paplay")) {
    Bun.spawnSync(["paplay", path], { stdout: "ignore", stderr: "ignore" });
  } else if (Bun.which("aplay")) {
    Bun.spawnSync(["aplay", "-q", path], { stdout: "ignore", stderr: "ignore" });
  } else if (Bun.which("ffplay")) {
    Bun.spawnSync(["ffplay", "-nodisp", "-autoexit", path], { stdout: "ignore", stderr: "ignore" });
  }
  try {
    unlinkSync(path);
  } catch {
    /* best-effort */
  }
}
