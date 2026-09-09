// Speech-to-text for spoken turns. Runs entirely on this machine: sherpa-onnx
// with the NeMo Parakeet model omp caches, no network and no API key.
//
// The model takes ~13s to load but transcribes at roughly 0.65x real time, so
// it is loaded once and held for the life of the process. Recognition is
// CPU-bound and single-threaded here, so calls are serialised: two phones
// talking at once would otherwise thrash the cores and make both slower.

import { mkdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { OfflineRecognizer, readWave } from "sherpa-onnx-node";

const DEFAULT_MODEL_DIR = join(
  homedir(),
  ".omp/agent/cache/tiny-models/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
);
const MODEL_DIR = process.env.DASH_STT_MODEL ?? DEFAULT_MODEL_DIR;

// Measured on a 4-core/8-thread Haswell: 4 threads gives rtf 0.66, 8 gives 1.29.
// The extra "cores" are hyperthread siblings and only add contention.
const NUM_THREADS = Number(process.env.DASH_STT_THREADS ?? "4");

/** Parakeet, like most ASR models, expects 16 kHz mono. */
const SAMPLE_RATE = 16_000;

const WORK_DIR = join(tmpdir(), "dash-voice");

export interface Transcription {
  text: string;
  /** Wall-clock milliseconds, for the latency log. */
  transcodeMs: number;
  sttMs: number;
  /** Length of the decoded audio, so callers can report a real-time factor. */
  audioSeconds: number;
}

function modelReadable(): boolean {
  return ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"].every((f) =>
    Bun.file(join(MODEL_DIR, f)).size > 0,
  );
}

/** Whether a spoken turn can be served at all. Checked before accepting audio. */
export function speechAvailable(): { ok: boolean; reason?: string } {
  if (Bun.which("ffmpeg") === null) {
    return { ok: false, reason: "ffmpeg is not on PATH; it is needed to decode phone audio." };
  }
  if (!modelReadable()) {
    return { ok: false, reason: `No speech model at ${MODEL_DIR}. Run \`omp setup speech\`.` };
  }
  return { ok: true };
}

let recognizer: OfflineRecognizer | null = null;
let loading: Promise<OfflineRecognizer> | null = null;

function load(): Promise<OfflineRecognizer> {
  if (recognizer) return Promise.resolve(recognizer);
  if (loading) return loading;
  loading = (async () => {
    const built = new OfflineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: join(MODEL_DIR, "encoder.int8.onnx"),
          decoder: join(MODEL_DIR, "decoder.int8.onnx"),
          joiner: join(MODEL_DIR, "joiner.int8.onnx"),
        },
        tokens: join(MODEL_DIR, "tokens.txt"),
        numThreads: NUM_THREADS,
        provider: "cpu",
        debug: 0,
        modelType: "nemo_transducer",
      },
      decodingMethod: "greedy_search",
    });
    recognizer = built;
    return built;
  })();
  return loading;
}

/** Pay the model load up front so the first spoken turn isn't the slow one. */
export function warmup(): Promise<void> {
  return load().then(() => undefined);
}

/** Serialises recognition; see the note at the top of the file. */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

async function transcode(input: string, output: string): Promise<void> {
  const proc = Bun.spawn(
    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", input,
     "-ar", String(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", output],
    { stdin: "ignore", stdout: "ignore", stderr: "pipe" },
  );
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`ffmpeg could not decode the recording: ${stderr.trim().slice(-400) || `exit ${exitCode}`}`);
  }
}

/**
 * Decode one recorded utterance to text. `audio` is whatever container the
 * phone recorded; ffmpeg normalises it before recognition.
 */
export function transcribe(audio: Uint8Array, id: string): Promise<Transcription> {
  return enqueue(async () => {
    mkdirSync(WORK_DIR, { recursive: true });
    // The phone's container is whatever the OS recorder produced; ffmpeg sniffs
    // it, so the extension here is only for debugging.
    const raw = join(WORK_DIR, `${id}.input`);
    const wav = join(WORK_DIR, `${id}.wav`);
    try {
      await Bun.write(raw, audio);

      const t0 = Date.now();
      await transcode(raw, wav);
      const transcodeMs = Date.now() - t0;

      const recogniser = await load();
      const wave = readWave(wav);
      const t1 = Date.now();
      const stream = recogniser.createStream();
      stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples });
      recogniser.decode(stream);
      const text = recogniser.getResult(stream).text.trim();
      const sttMs = Date.now() - t1;

      return { text, transcodeMs, sttMs, audioSeconds: wave.samples.length / wave.sampleRate };
    } finally {
      rmSync(raw, { force: true });
      rmSync(wav, { force: true });
    }
  });
}
