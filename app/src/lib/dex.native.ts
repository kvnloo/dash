import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { TURBO } from "../turbo";
import { DEX_OFF, type DexListener, type DexState, type DexSimulation } from "./dex-types";
export * from "./dex-types";
interface DashDexModule {
  getState(): Promise<DexState>;
  openPad(): Promise<void>;
  closePad(): Promise<void>;
  moveMainToDex(): Promise<void>;
  addListener(event: "dexState", listener: DexListener): { remove(): void };
}
const native = Platform.OS === "android" ? requireOptionalNativeModule<DashDexModule>("DashDex") : null;
/** Pad and window moves stay opt-in (turbo + EXPO_PUBLIC_DASH_DEX=1) until a device spike. */
export const available = TURBO && process.env.EXPO_PUBLIC_DASH_DEX === "1" && native !== null;
/** Detection is read-only and on wherever the module is in the APK; desk layout uses it. */
export const detects = native !== null;
export async function getState(): Promise<DexState> { return detects && native ? native.getState() : DEX_OFF; }
export async function openPad() { if (!available || !native) return false; await native.openPad(); return true; }
export async function closePad() { if (!available || !native) return false; await native.closePad(); return true; }
export async function moveMainToDex() { if (!available || !native) return false; await native.moveMainToDex(); return true; }
export function subscribe(listener: DexListener) {
  const sub = detects && native ? native.addListener("dexState", listener) : null;
  return () => sub?.remove();
}
export function simulate(_input: DexSimulation) { return DEX_OFF; }
