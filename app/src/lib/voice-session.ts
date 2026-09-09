/**
 * Hands-free capture. Records continuously, watches the mic level, and ships
 * one utterance every time the user stops talking, then immediately listens
 * again — so a conversation needs no button at all.
 *
 * Recording is file-based, so an utterance is a stop/read/restart cycle rather
 * than a live stream. The gap is a few tens of milliseconds, well under the
 * pause that ended the utterance in the first place.
 */

import { File } from "expo-file-system";
import { bytesToBase64 } from "./pair-crypto";
import { Vad } from "./vad";

/** Metering poll interval. Fast enough to resolve the 900ms end-of-speech pause. */
export const POLL_MS = 100;
/** Keep WebSocket frames modest; the bridge reassembles the utterance. */
const CHUNK_CHARS = 48 * 1024;
/** Metering is absent for the first frames after `record()`. */
const NO_SIGNAL_DB = -160;

export type VoicePhase = "idle" | "listening" | "hearing" | "thinking" | "speaking";

/** The slice of expo-audio's recorder this module needs, kept small to stay testable. */
export interface Recorder {
  readonly uri: string | null;
  prepareToRecordAsync(): Promise<void>;
  record(): void;
  stop(): Promise<void>;
  getStatus(): { isRecording: boolean; metering?: number };
}

export interface VoiceSessionHooks {
  onPhase(phase: VoicePhase): void;
  onLevel(db: number): void;
  /** Ship one utterance. Return false if it could not be sent (offline). */
  onUtterance(chunks: string[], mime: string): boolean;
  /** The user started talking over the reply. */
  onBargeIn(): void;
  onError(message: string): void;
}

function mimeFor(uri: string): string {
  const ext = uri.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "m4a" || ext === "mp4" || ext === "aac") return "audio/m4a";
  if (ext === "caf") return "audio/x-caf";
  if (ext === "3gp") return "audio/3gpp";
  if (ext === "wav") return "audio/wav";
  return "application/octet-stream";
}

export class VoiceSession {
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly vad = new Vad();
  private busy = false;
  private running = false;
  private phase: VoicePhase = "idle";
  private replyActive = false;

  constructor(
    private readonly recorder: Recorder,
    private readonly hooks: VoiceSessionHooks,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.beginRecording();
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  async stop(): Promise<void> {
    this.running = false;
    clearInterval(this.timer);
    this.timer = undefined;
    this.vad.reset();
    this.setPhase("idle");
    try {
      if (this.recorder.getStatus().isRecording) await this.recorder.stop();
    } catch {
      // Already stopped, or the recorder was torn down with the screen.
    }
  }

  /** Tells the session whether a reply is currently being spoken, for barge-in. */
  setReplyActive(active: boolean): void {
    this.replyActive = active;
    if (this.phase === "thinking" || this.phase === "speaking") {
      this.setPhase(active ? "speaking" : "listening");
    }
  }

  /** The turn finished, so we are back to plain listening. */
  turnSettled(): void {
    if (this.phase === "thinking") this.setPhase(this.replyActive ? "speaking" : "listening");
  }

  private async beginRecording(): Promise<void> {
    try {
      await this.recorder.prepareToRecordAsync();
      this.recorder.record();
      this.setPhase(this.replyActive ? "speaking" : "listening");
    } catch (error) {
      this.hooks.onError(error instanceof Error ? error.message : String(error));
      await this.stop();
    }
  }

  private async tick(): Promise<void> {
    if (this.busy || !this.running) return;
    const status = this.recorder.getStatus();
    if (!status.isRecording) return;
    const db = status.metering ?? NO_SIGNAL_DB;
    this.hooks.onLevel(db);

    const event = this.vad.update(db, Date.now());
    if (event === "speech-start") {
      if (this.replyActive) this.hooks.onBargeIn();
      this.setPhase("hearing");
      return;
    }
    if (event !== "speech-end" && event !== "too-short") return;

    this.busy = true;
    try {
      await this.finishUtterance(event === "speech-end");
    } catch (error) {
      this.hooks.onError(error instanceof Error ? error.message : String(error));
    } finally {
      this.busy = false;
    }
  }

  private async finishUtterance(send: boolean): Promise<void> {
    await this.recorder.stop();
    const uri = this.recorder.uri;
    if (send && uri) {
      const bytes = new Uint8Array(await new File(uri).arrayBuffer());
      const encoded = bytesToBase64(bytes);
      const chunks: string[] = [];
      for (let i = 0; i < encoded.length; i += CHUNK_CHARS) {
        chunks.push(encoded.slice(i, i + CHUNK_CHARS));
      }
      if (this.hooks.onUtterance(chunks, mimeFor(uri))) this.setPhase("thinking");
    }
    if (this.running) await this.beginRecording();
  }

  private setPhase(phase: VoicePhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.hooks.onPhase(phase);
  }
}
