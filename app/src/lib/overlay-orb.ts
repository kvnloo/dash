/**
 * The over-any-app z0live orb (native module dash-voice-orb, Android only). JS arms the native
 * service while Dash is in front; the service then follows the call over the bridge's SSE stream
 * by itself and asks back here only for fresh tokens. Absent module (web, Expo Go, older APK) = no-op.
 */
import { AppState, Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { executionToken, type AuthSettings } from "./bridge-auth";

interface VoiceOrbModule {
  canDrawOverlays(): boolean;
  arm(eventsUrl: string, token: string): Promise<void>;
  setToken(token: string): void;
  disarm(): Promise<void>;
  addListener(event: "onTokenNeeded", listener: () => void): { remove(): void };
}

const native = Platform.OS === "android" ? requireOptionalNativeModule<VoiceOrbModule>("DashVoiceOrb") : null;

export const voiceOrbAvailable = native !== null;

/** Arms the orb for this bridge; returns the disarm. */
export function armVoiceOrb(settings: AuthSettings & { address: string }): () => void {
  if (!native) return () => {};
  const orb = native;
  let disposed = false;
  const arm = async () => {
    if (disposed || AppState.currentState !== "active" || !orb.canDrawOverlays()) return;
    try {
      await orb.arm(`http://${settings.address}/z0live/events`, await executionToken(settings));
    } catch (error: unknown) {
      console.warn("[z0live-orb] arm failed", error);
    }
  };
  const tokens = orb.addListener("onTokenNeeded", () => {
    executionToken(settings).then((token) => { if (!disposed) orb.setToken(token); }, (error: unknown) => console.warn("[z0live-orb] token failed", error));
  });
  // Re-arm on every return to Dash: covers a just-granted overlay permission and a service the system stopped.
  const app = AppState.addEventListener("change", (state) => { if (state === "active") void arm(); });
  void arm();
  return () => {
    disposed = true;
    tokens.remove();
    app.remove();
    void orb.disarm();
  };
}
