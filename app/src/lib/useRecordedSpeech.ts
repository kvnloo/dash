import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { readRecording, transcribeRecording } from "./annotate/io";
import { microphone, RecordedSpeech, type CaptureOwner, type SpeechState } from "./recorded-speech";
import { store } from "../store/app";

/** Dash-native recording controls; no activity, recognizer popup or external fallback. */
export function useRecordedSpeech(owner: CaptureOwner, onText: (text: string, start: number, end: number) => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [state, setState] = useState<SpeechState>({ phase: "idle" });
  const current = useRef({ recorder, onText }); current.current = { recorder, onText };
  const mounted = useRef(true);
  const controller = useRef<RecordedSpeech | null>(null);
  if (!controller.current) {
    let settings: ReturnType<typeof store.get>["settings"] = null;
    controller.current = new RecordedSpeech(owner, microphone, {
      prepare: async () => {
        settings = store.get().settings;
        if (!settings) throw new Error("Pair the bridge to transcribe. Your draft is kept.");
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) throw new Error("Microphone permission denied. Allow it in Dash app permissions, then retry.");
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await current.current.recorder.prepareToRecordAsync();
      },
      record: () => current.current.recorder.record(),
      stop: () => current.current.recorder.stop(),
      transcribe: async () => {
        const uri = current.current.recorder.uri;
        if (!uri || !settings) throw new Error("No recording available. Your draft is kept; retry.");
        return transcribeRecording(settings, await readRecording(uri));
      },
      text: (text, start, end) => { if (mounted.current) current.current.onText(text, start, end); },
      changed: next => { if (mounted.current) setState(next); },
    });
  }
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener("change", next => { if (next === "background") void controller.current?.cancel(); });
    return () => { mounted.current = false; subscription.remove(); void controller.current?.cancel(); };
  }, []);
  return { state, begin: () => controller.current?.begin(), end: () => controller.current?.end(), cancel: () => controller.current?.cancel() };
}
