import { Platform } from "react-native";
import { requireOptionalNativeModule, type NativeModule } from "expo-modules-core";
import type { StylusButton } from "./stylus";
interface StylusModule extends NativeModule<{ button: (event: StylusButton) => void; replySelection: (event: { text: string }) => void }> {
  regionText(x: number, y: number, width: number, height: number): Promise<string>;
}
const native = Platform.OS === "android" ? requireOptionalNativeModule<StylusModule>("DashStylus") : null;
export function observeStylus(button: (event: StylusButton) => void, selection: (text: string) => void): () => void {
  if (!native) return () => {};
  const b = native.addListener("button", button);
  const s = native.addListener("replySelection", event => selection(event.text));
  return () => { b.remove(); s.remove(); };
}
export async function regionText(x: number, y: number, width: number, height: number): Promise<string> {
  return native ? native.regionText(x, y, width, height) : "";
}
