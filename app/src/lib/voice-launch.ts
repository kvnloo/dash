export interface VoiceLinker {
  openURL(url: string): Promise<unknown>;
}

export type VoiceLaunchResult =
  | { kind: "opened" }
  | { kind: "unavailable"; message: string };

export async function launchSharedVoice(platform: string, linker: VoiceLinker): Promise<VoiceLaunchResult> {
  if (platform !== "android") {
    return {
      kind: "unavailable",
      message: "Shared z0live voice is available on Android. You can use legacy voice here.",
    };
  }

  try {
    // Lawnchair's LinkActivity accepts this exact public URI and opens controls without starting capture.
    // Open directly: canOpenURL can hide installed handlers when Expo Go cannot declare package queries.
    await linker.openURL("z0live://voice");
    return { kind: "opened" };
  } catch {
    return {
      kind: "unavailable",
      message: "Could not open Lawnchair z0live. Check that it is installed, or install it, then try again. You can also use legacy voice.",
    };
  }
}
