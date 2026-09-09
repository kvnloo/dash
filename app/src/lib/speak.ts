/**
 * Speaks a reply on the phone as it streams in.
 *
 * The laptop deliberately does not synthesise audio: measured on the dev
 * machine, local neural TTS ran 6-13x slower than real time, which is useless
 * for conversation. On-device speech is instant, works offline, and keeps
 * working when the link is poor.
 */

import * as Speech from "expo-speech";

/** A sentence ends at .!? followed by space or newline, or at a hard break. */
const SENTENCE_END = /([.!?]["')\]]?)(\s)|(\n+)/;

/** Reading source code out loud is unbearable; say that it exists instead. */
function forSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, " (code) ")
    .replace(/`[^`\n]*`/g, " (code) ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[#>*-]+\s*/gm, "")
    .replace(/\*\*|__|\*|_/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Split off every complete sentence, returning the unfinished remainder. */
export function takeSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buffer;
  for (;;) {
    const match = SENTENCE_END.exec(rest);
    if (!match) break;
    const end = match.index + match[0].length;
    const sentence = rest.slice(0, end).trim();
    if (sentence) sentences.push(sentence);
    rest = rest.slice(end);
  }
  return { sentences, rest };
}

export class ReplySpeaker {
  private consumed = 0;
  private buffer = "";
  private speaking = false;

  constructor(private readonly onSpeakingChange: (speaking: boolean) => void) {}

  /** Feed the reply's full text so far; new complete sentences get spoken. */
  feed(fullText: string): void {
    if (fullText.length < this.consumed) this.reset();
    this.buffer += fullText.slice(this.consumed);
    this.consumed = fullText.length;
    const { sentences, rest } = takeSentences(this.buffer);
    this.buffer = rest;
    for (const sentence of sentences) this.say(sentence);
  }

  /** The turn ended: say whatever is left in the buffer. */
  flush(): void {
    const tail = this.buffer.trim();
    this.buffer = "";
    if (tail) this.say(tail);
  }

  /** Barge-in, cancel, or leaving the screen. */
  stop(): void {
    this.reset();
    Speech.stop();
    this.setSpeaking(false);
  }

  private reset(): void {
    this.consumed = 0;
    this.buffer = "";
  }

  private say(raw: string): void {
    const text = forSpeech(raw);
    if (!text) return;
    this.setSpeaking(true);
    Speech.speak(text, {
      onDone: () => this.settle(),
      onStopped: () => this.settle(),
      onError: () => this.settle(),
    });
  }

  private settle(): void {
    // `isSpeakingAsync` is the only reliable way to know the queue drained;
    // onDone fires per utterance, not per reply.
    void Speech.isSpeakingAsync().then((busy) => {
      if (!busy) this.setSpeaking(false);
    });
  }

  private setSpeaking(value: boolean): void {
    if (this.speaking === value) return;
    this.speaking = value;
    this.onSpeakingChange(value);
  }
}
