export interface VoiceLinker {
  openURL(url: string): Promise<unknown>;
}

export type VoiceLaunchResult = { kind: "unavailable"; message: string };

/** No installed in-app media client: never silently hand off to an external activity. */
export async function launchSharedVoice(_platform: string, _linker: VoiceLinker): Promise<VoiceLaunchResult> {
  return {
    kind: "unavailable",
    message: "In-app z0live is not connected yet. WebRTC microphone capture in this Expo Go runtime is not verified. Dash needs its own broker device pairing and a secure microphone origin. No external app was opened. System Dictate still works from the composer. Legacy voice is a separate, optional turn-based mode, not z0live.",
  };
}
