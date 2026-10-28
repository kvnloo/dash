// Speech-to-text for spoken turns. Model load and decode run on a dedicated
// Bun Worker, not the bridge event loop. One request runs at a time so phones
// do not compete for the host's recognition cores.
import { mkdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { SpeechResult, SpeechWorkerRequest } from "./src/speech-worker";

const DEFAULT_MODEL_DIR = join(
  homedir(),
  ".omp/agent/cache/tiny-models/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
);
const MODEL_DIR = process.env.DASH_STT_MODEL ?? DEFAULT_MODEL_DIR;
const FIXTURE = process.env.DASH_STT_ENGINE === "fixture";
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
  return ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"].every(
    file => Bun.file(join(MODEL_DIR, file)).size > 0,
  );
}

/** Whether the bridge can accept a spoken turn. Fixture mode is model-free. */
export function speechAvailable(): { ok: boolean; reason?: string } {
  if (FIXTURE) return { ok: true };
  if (Bun.which("ffmpeg") === null) {
    return { ok: false, reason: "ffmpeg is not on PATH; it is needed to decode phone audio." };
  }
  if (!modelReadable()) {
    return { ok: false, reason: "No speech model at " + MODEL_DIR + ". Run `omp setup speech`." };
  }
  return { ok: true };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isSpeechResult = (value: unknown): value is SpeechResult =>
  isObject(value) && typeof value.text === "string" &&
  typeof value.sttMs === "number" && Number.isFinite(value.sttMs) &&
  typeof value.audioSeconds === "number" && Number.isFinite(value.audioSeconds);

type Pending = { id: number; resolve(value: SpeechResult): void; reject(error: Error): void };
let worker: Worker | undefined;
let pending: Pending | undefined;
let nextId = 0;

/** An uncaught worker error/exit fails the current request; the next call starts fresh. */
function workerDied(instance: Worker, why: string): void {
  if (worker !== instance) return;
  worker = undefined;
  const job = pending;
  pending = undefined;
  job?.reject(new Error("Speech worker " + why + "; the next request will restart it."));
}

function getWorker(): Worker {
  if (worker) return worker;
  const instance = new Worker(new URL("./src/speech-worker.ts", import.meta.url).href);
  instance.unref();
  worker = instance;
  instance.addEventListener("error", () => workerDied(instance, "crashed"));
  instance.addEventListener("close", () => workerDied(instance, "exited unexpectedly"));
  instance.onmessage = (event: MessageEvent<unknown>) => {
    if (worker !== instance || !pending) return;
    const job = pending;
    const reply: unknown = event.data;
    if (!isObject(reply) || reply.id !== job.id) {
      workerDied(instance, "sent an invalid response");
      return;
    }
    pending = undefined;
    if (reply.ok === true && isSpeechResult(reply.result)) job.resolve(reply.result);
    else if (reply.ok === false && typeof reply.error === "string")
      job.reject(new Error("Speech recognition failed: " + reply.error));
    else {
      worker = undefined;
      job.reject(new Error("Speech worker returned an invalid result; the next request will restart it."));
    }
  };
  return instance;
}

/** Only called inside the serial queue: at most one in-flight worker RPC. */
function callWorker(request: SpeechWorkerRequest): Promise<SpeechResult> {
  return new Promise((resolve, reject) => {
    let instance: Worker;
    try {
      instance = getWorker();
    } catch (error) {
      reject(new Error("Speech worker could not start: " + String(error)));
      return;
    }
    pending = { id: request.id, resolve, reject };
    try {
      instance.postMessage(request);
    } catch (error) {
      workerDied(instance, "could not accept the request (" + String(error) + ")");
    }
  });
}

/** Serialise both model warmup and decoding, including requests from other phones. */
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

/** Load the model once in the worker so the first recording has no cold-start. */
export function warmup(): Promise<void> {
  return enqueue(async () => {
    await callWorker({ id: ++nextId, op: "warmup" });
  });
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
    throw new Error("ffmpeg could not decode the recording: " + (stderr.trim().slice(-400) || "exit " + exitCode));
  }
}

/** Convert the phone's audio asynchronously, then decode it off the bridge thread. */
export function transcribe(audio: Uint8Array, id: string): Promise<Transcription> {
  return enqueue(async () => {
    if (FIXTURE) {
      // Exercise the same worker RPC with genuine request bytes; never open ffmpeg or the model.
      const heard = await callWorker({ id: ++nextId, op: "transcribe", audio });
      return { ...heard, transcodeMs: 0 };
    }
    mkdirSync(WORK_DIR, { recursive: true });
    const raw = join(WORK_DIR, id + ".input");
    const wav = join(WORK_DIR, id + ".wav");
    try {
      await Bun.write(raw, audio);
      const t0 = Date.now();
      await transcode(raw, wav);
      const transcodeMs = Date.now() - t0;
      const heard = await callWorker({ id: ++nextId, op: "transcribe", wav });
      return { ...heard, transcodeMs };
    } finally {
      rmSync(raw, { force: true });
      rmSync(wav, { force: true });
    }
  });
}
