import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PAIR_CHARSET } from "./pair";

const TONE_MS = 400;
const GAP_MS = 200;
const BASE_HZ = 880;
const STEP_HZ = 55;
const SAMPLE_RATE = 44100;

function charHz(index: number): number {
  return BASE_HZ + index * STEP_HZ;
}

function goertzelPower(samples: Float32Array, sampleRate: number, targetHz: number): number {
  const k = Math.round((samples.length * targetHz) / sampleRate);
  const w = (2 * Math.PI * k) / samples.length;
  const cosine = Math.cos(w);
  const sine = Math.sin(w);
  const coeff = 2 * cosine;
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;
  for (let i = 0; i < samples.length; i++) {
    q0 = coeff * q1 - q2 + samples[i]!;
    q2 = q1;
    q1 = q0;
  }
  const real = q1 - q2 * cosine;
  const imag = q2 * sine;
  return real * real + imag * imag;
}

function bestChar(window: Float32Array, sampleRate: number): string | null {
  let bestIdx = -1;
  let bestPower = 0;
  let secondPower = 0;
  for (let i = 0; i < PAIR_CHARSET.length; i++) {
    const power = goertzelPower(window, sampleRate, charHz(i));
    if (power > bestPower) {
      secondPower = bestPower;
      bestPower = power;
      bestIdx = i;
    } else if (power > secondPower) secondPower = power;
  }
  if (bestIdx < 0 || bestPower < 1e3 || bestPower < secondPower * 1.25) return null;
  return PAIR_CHARSET[bestIdx] ?? null;
}

export function decodePairPcm(samples: Float32Array, sampleRate = SAMPLE_RATE): string | null {
  const toneN = Math.floor(sampleRate * (TONE_MS / 1000));
  const stepN = Math.floor(sampleRate * ((TONE_MS + GAP_MS) / 1000));
  const inner = Math.floor(toneN * 0.2);
  const hop = Math.max(1, Math.floor(sampleRate * 0.015));
  const span = toneN + 5 * stepN;
  if (samples.length < span) return null;
  const last = samples.length - span;
  for (let start = 0; start <= last; start += hop) {
    let code = "";
    let ok = true;
    for (let i = 0; i < 6; i++) {
      const from = start + i * stepN + inner;
      const window = samples.subarray(from, from + (toneN - 2 * inner));
      const ch = bestChar(window, sampleRate);
      if (!ch) {
        ok = false;
        break;
      }
      code += ch;
    }
    if (ok) return code;
  }
  return null;
}

function pcmFromF32le(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = Math.floor(bytes.byteLength / 4);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = view.getFloat32(i * 4, true);
  return samples;
}

export async function decodePairAudio(bytes: Uint8Array): Promise<string | null> {
  const dir = mkdtempSync(join(tmpdir(), "dash-pair-"));
  const input = join(dir, "clip.bin");
  writeFileSync(input, bytes);
  try {
    const proc = Bun.spawn(
      ["ffmpeg", "-nostdin", "-v", "error", "-i", input, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "pipe:1"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const pcm = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
    const err = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0 || pcm.byteLength < SAMPLE_RATE) {
      if (err) console.error("pair.decode.ffmpeg", err.trim());
      return null;
    }
    return decodePairPcm(pcmFromF32le(pcm));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
