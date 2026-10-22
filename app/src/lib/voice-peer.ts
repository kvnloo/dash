import type { VoicePeer } from "./continuous-voice";

export async function createVoicePeer(_event: (raw: string) => void, _ready: () => void, _lost: () => void): Promise<VoicePeer> {
  throw new Error("Continuous voice is unavailable in Expo Go/web. Use the reviewed native Dash APK.");
}
