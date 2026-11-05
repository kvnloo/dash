import { expect, spyOn, test } from "bun:test";
import { decodePairAudio, MAX_PAIR_AUDIO_SECONDS, PAIR_SAMPLE_RATE } from "../pair-decode";

function toneWav(code: string, seconds = 4): Uint8Array {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const count = Math.floor(PAIR_SAMPLE_RATE * seconds);
  const wav = Buffer.alloc(44 + count * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(PAIR_SAMPLE_RATE, 24);
  wav.writeUInt32LE(PAIR_SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i += 1) {
    const time = i / PAIR_SAMPLE_RATE;
    const slot = Math.floor(time / 0.6);
    const offset = time - slot * 0.6;
    const char = code[slot];
    if (char === undefined || offset >= 0.4) continue;
    const hz = 880 + charset.indexOf(char) * 55;
    wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * time) * 12000), 44 + i * 2);
  }
  return new Uint8Array(wav);
}

test("real bounded ffmpeg decoder preserves sonic pair codes", async () => {
  expect(Bun.which("ffmpeg") !== null).toBe(true);
  expect(await decodePairAudio(toneWav("ABCDEF"))).toBe("ABCDEF");
});

test("audio beyond the duration cap cannot provide a pairing code", async () => {
  const late = toneWav("ABCDEF");
  const padding = MAX_PAIR_AUDIO_SECONDS + 1;
  const count = padding * PAIR_SAMPLE_RATE + (late.length - 44) / 2;
  const wav = Buffer.alloc(44 + count * 2);
  wav.set(late.subarray(0, 44));
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.writeUInt32LE(count * 2, 40);
  wav.set(late.subarray(44), 44 + padding * PAIR_SAMPLE_RATE * 2);
  expect(await decodePairAudio(new Uint8Array(wav))).toBeNull();
});

test("invalid containers fail without logging decoder stderr", async () => {
  const errors = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await decodePairAudio(new TextEncoder().encode("invalid audio"))).toBeNull();
    expect(errors).toHaveBeenCalledTimes(0);
  } finally { errors.mockRestore(); }
});
