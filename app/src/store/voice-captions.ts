// Live caption strip state for a z0live call (DA-056). The caption is per-delta, so it lives in its
// own tiny store that only the one-line strip subscribes to, never in the voice root's React state
// or the chats store. The on/off choice is a device preference persisted under one key.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createStore } from "./createStore";
import type { VoiceCaption } from "../lib/voice-captions";

const KEY = "dash.voice.captions";

/** The newest user or agent text of the live call (partial while it streams). */
export const voiceCaption = createStore<VoiceCaption | null>(null);

/** Show the live caption strip. Default on; the CC control turns it off for this device. */
export const voiceCaptionsEnabled = createStore(true);

let changedBeforeRestore = false;
const restored = AsyncStorage.getItem(KEY).then(raw => {
  if (!changedBeforeRestore && (raw === "on" || raw === "off")) voiceCaptionsEnabled.set(raw === "on");
}).catch(() => {});

export function setVoiceCaptionsEnabled(on: boolean): void {
  changedBeforeRestore = true;
  voiceCaptionsEnabled.set(on);
  void restored.then(() => AsyncStorage.setItem(KEY, on ? "on" : "off")).catch(() => {});
}
