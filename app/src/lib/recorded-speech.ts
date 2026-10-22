// One process-wide microphone lease; acquire BEFORE async permissions/preparation.
export type CaptureOwner = "annotation" | "dictation" | "live";
export class CaptureGate {
  private lease?: { owner: CaptureOwner };
  get owner(): CaptureOwner | undefined { return this.lease?.owner; }
  acquire(owner: CaptureOwner): (() => void) | undefined {
    if (this.lease) return undefined;
    const lease = { owner }; this.lease = lease;
    return () => { if (this.lease === lease) this.lease = undefined; };
  }
}
export const microphone = new CaptureGate();
export interface SpeechState { phase: "idle" | "preparing" | "recording" | "transcribing" | "error"; note?: string }
interface SpeechIO {
  prepare(): Promise<void>; record(): void; stop(): Promise<void>; transcribe(): Promise<string>;
  text(text: string, start: number, end: number): void; changed(state: SpeechState): void;
}
interface Capture {
  release(): void; preparing: Promise<void>; started: boolean; cancelled: boolean;
  start: number; ending?: Promise<void>;
}
export class RecordedSpeech {
  private capture?: Capture;
  constructor(private owner: CaptureOwner, private gate: CaptureGate, private io: SpeechIO) {}
  async begin(): Promise<void> {
    if (this.capture) return;
    const release = this.gate.acquire(this.owner);
    if (!release) { this.io.changed({ phase: "error", note: `Microphone is in use by ${this.gate.owner}. Stop that capture first.` }); return; }
    const capture: Capture = { release, preparing: Promise.resolve(), started: false, cancelled: false, start: 0 };
    this.capture = capture;
    this.io.changed({ phase: "preparing", note: "Preparing microphone…" });
    let failed = false;
    try {
      capture.preparing = this.io.prepare();
      await capture.preparing;
      if (capture.cancelled) { await this.io.stop().catch(() => {}); return; }
      this.io.record(); capture.started = true; capture.start = Date.now();
      this.io.changed({ phase: "recording", note: "Listening · tap Stop when finished" });
    } catch (error) {
      failed = true;
      capture.cancelled = true;
      await this.io.stop().catch(() => {});
      this.io.changed({ phase: "error", note: error instanceof Error ? error.message : "Microphone unavailable. Try again." });
    } finally {
      if (!capture.started) {
        capture.release(); if (this.capture === capture) this.capture = undefined;
        if (capture.cancelled && !failed) this.io.changed({ phase: "idle" });
      }
    }
  }
  async end(): Promise<void> {
    const capture = this.capture; if (!capture) return;
    if (!capture.started) {
      capture.cancelled = true;
      await capture.preparing.catch(() => {});
      return;
    }
    if (capture.ending) return capture.ending;
    const end = Date.now();
    capture.ending = (async () => {
      try {
        this.io.changed({ phase: "transcribing", note: "Transcribing…" });
        await this.io.stop();
        if (capture.cancelled) return;
        const text = await this.io.transcribe();
        if (!capture.cancelled && text.trim()) this.io.text(text.trim(), capture.start, end);
        this.io.changed({ phase: "idle", note: text.trim() ? undefined : "No words heard. Try again." });
      } catch (error) {
        if (!capture.cancelled) this.io.changed({ phase: "error", note: error instanceof Error ? error.message : "Transcription unavailable. Try again." });
      } finally {
        capture.release(); if (this.capture === capture) this.capture = undefined;
      }
    })();
    return capture.ending;
  }
  async cancel(): Promise<void> {
    const capture = this.capture; if (!capture) return;
    capture.cancelled = true; await this.end();
  }
}
