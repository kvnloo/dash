import { createStore } from "../store/createStore";
import type { VoiceState } from "./continuous-voice";

/** The current real call phase, independent of whether a voice UI is visible. */
export const voicePhase = createStore<VoiceState["phase"]>("idle");
