

export type DictationResult =
  | { ok: true; text: string; ms: number }
  | { ok: false; reason: "canceled" | "unsupported" | "error"; message?: string; ms: number };

/** Inert compatibility API. Composer uses useRecordedSpeech with Dash-native controls. */
export async function dictate(_language?: string): Promise<DictationResult> {
  return { ok: false, reason: "unsupported", message: "Use the dictation controls inside Dash. No external speech activity is opened.", ms: 0 };
}
