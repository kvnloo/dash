/** Must match `bridge/pair-audio.ts` and `bridge/pair.ts`. */
export const PAIR_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const TONE_MS = 400;
export const GAP_MS = 200;
export const BASE_HZ = 880;
export const STEP_HZ = 55;

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
    q0 = coeff * q1 - q2 + (samples[i] ?? 0);
    q2 = q1;
    q1 = q0;
  }
  const real = q1 - q2 * cosine;
  const imag = q2 * sine;
  return real * real + imag * imag;
}

function parseWavPcm16(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, false) !== 0x52494646) return null;
  if (view.getUint32(8, false) !== 0x57415645) return null;
  let offset = 12;
  let sampleRate = 44100;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const id = view.getUint32(offset, false);
    const size = view.getUint32(offset + 4, true);
    if (id === 0x666d7420) sampleRate = view.getUint32(offset + 12, true);
    else if (id === 0x64617461) {
      dataOffset = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataOffset < 0 || dataOffset + dataSize > bytes.length) return null;
  const count = Math.floor(dataSize / 2);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) samples[i] = view.getInt16(dataOffset + i * 2, true) / 32768;
  return { samples, sampleRate };
}

export function decodePairCodeFromWav(bytes: Uint8Array): string | null {
  const parsed = parseWavPcm16(bytes);
  if (!parsed) return null;
  const { samples, sampleRate } = parsed;
  const toneSamples = Math.floor(sampleRate * (TONE_MS / 1000));
  const stepSamples = Math.floor(sampleRate * ((TONE_MS + GAP_MS) / 1000));
  if (toneSamples < 32) return null;
  let code = "";
  for (let start = 0; start + toneSamples <= samples.length && code.length < 6; start += stepSamples) {
    const window = samples.subarray(start, start + toneSamples);
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
    if (bestIdx < 0 || bestPower < 1e6 || bestPower < secondPower * 1.35) continue;
    code += PAIR_CHARSET[bestIdx];
  }
  return code.length === 6 ? code : null;
}
