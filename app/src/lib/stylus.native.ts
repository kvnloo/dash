import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import type { StylusButton } from "./stylus";
interface StylusModule {
  addListener(event: "button", listener: (event: StylusButton) => void): { remove(): void };
  addListener(event: "replySelection", listener: (event: { text: string }) => void): { remove(): void };
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
