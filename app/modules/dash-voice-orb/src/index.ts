/**
 * DashVoiceOrb — thin TypeScript wrapper over the Kotlin Expo module.
 * Stubs out gracefully on web / Expo Go (no native module available).
 */
import { NativeModules, Platform } from "react-native";

const Native = Platform.OS === "android" ? NativeModules.DashVoiceOrb : null;

export const DashVoiceOrb = {
  startOrb: (phase: string, muted: boolean): Promise<void> =>
    Native ? Native.startOrb(phase, muted) : Promise.resolve(),

  updateOrb: (phase: string, muted: boolean): Promise<void> =>
    Native ? Native.updateOrb(phase, muted) : Promise.resolve(),

  stopOrb: (): Promise<void> =>
    Native ? Native.stopOrb() : Promise.resolve(),

  setAppForegrounded: (foregrounded: boolean): Promise<void> =>
    Native ? Native.setAppForegrounded(foregrounded) : Promise.resolve(),

  getOverlayPermissionGranted: (): boolean =>
    Native ? Native.getOverlayPermissionGranted() : false,

  requestOverlayPermission: (): Promise<void> =>
    Native ? Native.requestOverlayPermission() : Promise.resolve(),
};
