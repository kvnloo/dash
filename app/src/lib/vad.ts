/**
 * Voice-activity detection over the recorder's metering level, so the user can
 * just talk instead of holding a button.
 *
 * Metering is dBFS: 0 is clipping, -160 is silence. The thresholds below are
 * deliberately forgiving — a missed utterance is far more annoying than an
 * extra half second of recording, and a phone in a pocket or a noisy street
 * should not strand the conversation.
 */

/** Above this, the mic is hearing speech rather than room tone. */
export const SPEECH_DB = -32;
/**
 * Hysteresis. Once speaking, the level has to fall below this (not merely
 * below SPEECH_DB) to count as a pause, so normal dips between words don't
 * chop an utterance in half.
 */
export const SILENCE_DB = -40;
/** How long it must stay quiet before the utterance is considered finished. */
export const SILENCE_MS = 900;
/** Shorter bursts are coughs, taps, and door slams — not speech. */
export const MIN_SPEECH_MS = 350;
/** Hard stop, so a noisy room can't record forever. */
export const MAX_UTTERANCE_MS = 30_000;

export type VadEvent = "speech-start" | "speech-end" | "too-short" | null;

export class Vad {
  private speaking = false;
  private startedAt = 0;
  private quietSince = 0;

  reset(): void {
    this.speaking = false;
    this.startedAt = 0;
    this.quietSince = 0;
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** Feed one metering sample; returns an event when the utterance boundary moves. */
  update(db: number, now: number): VadEvent {
    if (!this.speaking) {
      if (db < SPEECH_DB) return null;
      this.speaking = true;
      this.startedAt = now;
      this.quietSince = 0;
      return "speech-start";
    }

    const spoken = now - this.startedAt;
    if (spoken >= MAX_UTTERANCE_MS) {
      this.reset();
      return "speech-end";
    }

    if (db >= SILENCE_DB) {
      this.quietSince = 0;
      return null;
    }

    if (this.quietSince === 0) {
      this.quietSince = now;
      return null;
    }
    if (now - this.quietSince < SILENCE_MS) return null;

    // The pause counts as the end. Whether it was real speech depends on how
    // much of the segment was above the silence floor.
    const voiced = this.quietSince - this.startedAt;
    this.reset();
    return voiced >= MIN_SPEECH_MS ? "speech-end" : "too-short";
  }
}
