import { RecordingPresets, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { readRecording, transcribeRecording } from "./annotate/io";
import { microphone, RecordedSpeech, type CaptureOwner, type SpeechState } from "./recorded-speech";
import { ensureMicPermission, permissionRequestInFlight } from "./mic-permission";
import { store } from "../store/app";

/** Dash-native recording controls; no activity, recognizer popup or external fallback. */
export function useRecordedSpeech(owner: CaptureOwner, onText: (text: string, start: number, end: number) => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [state, setState] = useState<SpeechState>({ phase: "idle" });
  const current = useRef({ recorder, onText }); current.current = { recorder, onText };
  const mounted = useRef(true);
  const permissionPending = useRef(false);
  const controller = useRef<RecordedSpeech | null>(null);
  if (!controller.current) {
    let settings: ReturnType<typeof store.get>["settings"] = null;
    controller.current = new RecordedSpeech(owner, microphone, {
      prepare: async () => {
        settings = store.get().settings;
        if (!settings) throw new Error("Pair the bridge to transcribe. Your draft is kept.");
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
    const subscription = AppState.addEventListener("change", next => {
      if (next === "background" && !permissionRequestInFlight()) void controller.current?.cancel();
    });
    return () => { mounted.current = false; subscription.remove(); void controller.current?.cancel(); };
  }, []);
  const begin = async () => {
    if (permissionPending.current) return;
    // A second tap ends an existing recording; only a new capture needs permission preflight.
    if (["preparing", "recording", "transcribing"].includes(state.phase)) {
      await controller.current?.begin();
      return;
    }
    permissionPending.current = true;
    try {
      if (!await ensureMicPermission()) {
        if (mounted.current) setState({ phase: "error", note: "Microphone permission denied. Allow it in Dash app permissions, then retry." });
        return;
      }
      if (mounted.current) await controller.current?.begin();
    } catch (error) {
      if (mounted.current) setState({ phase: "error", note: error instanceof Error ? error.message : "Microphone unavailable. Try again." });
    } finally {
      permissionPending.current = false;
    }
  };
  return { state, begin, end: () => controller.current?.end(), cancel: () => controller.current?.cancel() };
}
