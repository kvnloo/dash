import { parseRecognizerResult } from "./mic-gesture";

export type DictationOutcome = { ok: true; text: string } | { ok: false; reason: "canceled" | "unsupported" | "error"; message?: string };
export function recognizerOutcome(result: { resultCode: number; extra?: unknown }): DictationOutcome {
  const text = parseRecognizerResult(result);
  if (text) return { ok: true, text };
  if (result.resultCode === 0) return { ok: false, reason: "canceled" };
  return { ok: false, reason: "error", message: result.resultCode === -1 ? "The system recognizer returned no transcript. Try again or use keyboard voice typing." : `The system recognizer returned result code ${result.resultCode}.` };
}
/** A single Android activity-result slot, shared by every mounted composer. */
export function createRecognizerGate() {
  let pending = false;
  return {
    async run<T>(recognize: () => Promise<T>): Promise<{ kind: "busy" } | { kind: "result"; value: T }> {
      if (pending) return { kind: "busy" };
      pending = true;
      try { return { kind: "result", value: await recognize() }; }
      finally { pending = false; }
    },
  };
}
