// Dedicated Bun Worker: sherpa-onnx N-API import, model construction, WAV
// reading and synchronous recognition never execute on the HTTP/WebSocket thread.
import { homedir } from "node:os";
import { join } from "node:path";

export interface SpeechResult {
  text: string;
  sttMs: number;
  audioSeconds: number;
}
export type SpeechWorkerRequest =
  | { id: number; op: "warmup" }
  | { id: number; op: "transcribe"; wav: string }
  | { id: number; op: "transcribe"; audio: Uint8Array };
export type SpeechWorkerReply =
  | { id: number; ok: true; result: SpeechResult }
  | { id: number; ok: false; error: string };

const FIXTURE = process.env.DASH_STT_ENGINE === "fixture";
const DEFAULT_MODEL_DIR = join(
  homedir(),
  ".omp/agent/cache/tiny-models/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
);
const MODEL_DIR = process.env.DASH_STT_MODEL ?? DEFAULT_MODEL_DIR;
const NUM_THREADS = Number(process.env.DASH_STT_THREADS ?? "4");
const SAMPLE_RATE = 16_000;

type Engine = {
  recognizer: import("sherpa-onnx-node").OfflineRecognizer;
  readWave: typeof import("sherpa-onnx-node").readWave;
};
let loading: Promise<Engine> | undefined;
function load(): Promise<Engine> {
  if (!loading) {
    // Import lazily: fixture mode never loads the native addon. A failed
    // construction is not cached forever; a later request may try again.
    loading = import("sherpa-onnx-node").then(addon => ({
      recognizer: new addon.OfflineRecognizer({
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
      }),
      readWave: addon.readWave,
    })).catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
  }
  return loading;
}

async function execute(request: SpeechWorkerRequest): Promise<SpeechResult> {
  if (request.op === "warmup") {
    if (!FIXTURE) await load();
    return { text: "", sttMs: 0, audioSeconds: 0 };
  }
  if (FIXTURE) {
    if (!("audio" in request)) throw new Error("Fixture STT expected recording bytes.");
    const rawBusyMs = Number(process.env.DASH_STT_FIXTURE_BUSY_MS ?? "0");
    const busyMs = Number.isFinite(rawBusyMs) ? Math.max(0, Math.floor(rawBusyMs)) : 0;
    const start = Date.now();
    // Intentionally CPU-bound: the army proves this cannot block bridge HTTP.
    while (Date.now() - start < busyMs) { /* keep this work on the Worker */ }
    return { text: request.audio.byteLength ? "ARMY heard you" : "", sttMs: Date.now() - start, audioSeconds: 0 };
  }
  if (!("wav" in request)) throw new Error("A transcoded WAV path is required.");
  const { recognizer, readWave } = await load();
  const wave = readWave(request.wav);
  const started = Date.now();
  const stream = recognizer.createStream();
  stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples });
  recognizer.decode(stream);
  return {
    text: recognizer.getResult(stream).text.trim(),
    sttMs: Date.now() - started,
    audioSeconds: wave.samples.length / wave.sampleRate,
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function isRequest(value: unknown): value is SpeechWorkerRequest {
  if (!isObject(value) || !Number.isSafeInteger(value.id)) return false;
  if (value.op === "warmup") return true;
  return value.op === "transcribe" &&
    (typeof value.wav === "string" || value.audio instanceof Uint8Array);
}

declare const self: Worker;
if (!Bun.isMainThread) {
  self.onmessage = async (event: MessageEvent<unknown>) => {
    const request: unknown = event.data;
    if (!isRequest(request)) return;
    try {
      const result = await execute(request);
      const response: SpeechWorkerReply = { id: request.id, ok: true, result };
      self.postMessage(response);
    } catch (error) {
      const response: SpeechWorkerReply = {
        id: request.id, ok: false, error: error instanceof Error ? error.message : String(error),
      };
      self.postMessage(response);
    }
  };
}
