export interface VoiceLinker {
  openURL(url: string): Promise<unknown>;
}

export type VoiceLaunchResult =
  | { kind: "opened" }
  | { kind: "unavailable"; message: string };

/** Compatibility entry only. Native callers use the app-root ContinuousVoice controller. */
export async function launchSharedVoice(_platform: string, _linker: VoiceLinker): Promise<VoiceLaunchResult> {
  return { kind: "unavailable", message: "Use native continuous voice inside Dash. Expo Go/web voice is unavailable; no external app is opened." };
}
