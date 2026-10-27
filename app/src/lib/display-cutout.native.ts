import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { parseCutout, type CutoutReading } from "./chat-window";

type CutoutModule = { read(): unknown };

// Optional: Expo Go and APKs built before app/modules/dash-cutout lack it and keep the fallback.
const native = Platform.OS === "android" ? requireOptionalNativeModule<CutoutModule>("DashDisplayCutout") : null;

/** The app window's DisplayCutout rects in DIP (converted once natively), or null. */
export function readCutout(): CutoutReading | null {
  if (!native) return null;
  try {
    return parseCutout(native.read());
  } catch {
    return null;
  }
}
