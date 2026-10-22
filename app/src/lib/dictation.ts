import { Platform } from "react-native";
import { startActivityAsync } from "expo-intent-launcher";
import { RECOGNIZE_SPEECH } from "./mic-gesture";
import { createRecognizerGate, recognizerOutcome, type DictationOutcome } from "./dictation-result";

export type DictationResult = DictationOutcome & { ms: number };
const recognizer = createRecognizerGate();

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
    const recognition = await recognizer.run(() => startActivityAsync(RECOGNIZE_SPEECH, { extra }));
    if (recognition.kind === "busy") return { ok: false, reason: "canceled", ms: 0 };
    const result = recognition.value;
    const ms = Date.now() - t0;
    if (__DEV__) console.log("[dictation] result", JSON.stringify({ resultCode: result.resultCode, keys: Object.keys(result.extra ?? {}), ms }));
    return { ...recognizerOutcome(result), ms };
  } catch (error) {
    return { ok: false, reason: "error", message: error instanceof Error ? error.message : String(error), ms: Date.now() - t0 };
  }
}
