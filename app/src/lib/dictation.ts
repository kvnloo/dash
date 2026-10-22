import { Platform } from "react-native";
import { startActivityAsync } from "expo-intent-launcher";
import { RECOGNIZE_SPEECH, parseRecognizerResult } from "./mic-gesture";

export type DictationResult =
  | { ok: true; text: string; ms: number }
  | { ok: false; reason: "canceled" | "unsupported" | "error"; message?: string; ms: number };

/** Opens Android's system speech recognizer (Google's or Samsung's, whichever is default): a voice popup, no keyboard.
 *  expo-intent-launcher ships in Expo Go, so no custom native module is needed. */
export async function dictate(language?: string): Promise<DictationResult> {
  const t0 = Date.now();
  if (Platform.OS !== "android") return { ok: false, reason: "unsupported", message: "System dictation is Android-only here.", ms: 0 };
  if (__DEV__) console.log("[dictation] start");
  try {
    const extra: Record<string, unknown> = {
      "android.speech.extra.LANGUAGE_MODEL": "free_form",
      "android.speech.extra.MAX_RESULTS": 3,
      "android.speech.extra.PROMPT": "Speak",
    };
    if (language) extra["android.speech.extra.LANGUAGE"] = language;
    const result = await startActivityAsync(RECOGNIZE_SPEECH, { extra });
    const ms = Date.now() - t0;
    if (__DEV__) console.log("[dictation] result", JSON.stringify({ resultCode: result.resultCode, keys: Object.keys(result.extra ?? {}), ms }));
    const text = parseRecognizerResult(result);
    return text ? { ok: true, text, ms } : { ok: false, reason: "canceled", ms };
  } catch (error) {
    return { ok: false, reason: "error", message: error instanceof Error ? error.message : String(error), ms: Date.now() - t0 };
  }
}
