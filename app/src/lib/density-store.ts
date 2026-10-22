import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useSyncExternalStore } from "react";
import { createStore } from "../store/createStore";
import { DEFAULT_PREFS, densityReducer, parsePrefs, type DensityAction, type DensityPrefs } from "./density";

const KEY = "dash.density.v1";

/** Global default plus per-screen and per-chat overrides, persisted on every change. */
export const densityStore = createStore<DensityPrefs>(DEFAULT_PREFS);

let loaded = false;
export async function loadDensity(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) densityStore.set(parsePrefs(JSON.parse(raw)));
  } catch {
    // Corrupt prefs fall back to defaults; the next change rewrites them.
  }
}

export function dispatchDensity(action: DensityAction): void {
  const next = densityReducer(densityStore.get(), action);
  if (next === densityStore.get()) return;
  densityStore.set(next);
  void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
}

export function useDensityPrefsLoaded(): void {
  useEffect(() => { void loadDensity(); }, []);
}

/** One-time hints and per-screen card visibility share a tiny persisted flag store. */
const FLAGS_KEY = "dash.ui-flags.v1";
export const uiFlags = createStore<Record<string, boolean>>({});
let flagsLoaded = false;
export function useUiFlag(id: string, fallback: boolean): [boolean, (value: boolean) => void] {
  useEffect(() => {
    if (flagsLoaded) return;
    flagsLoaded = true;
    void AsyncStorage.getItem(FLAGS_KEY).then(raw => {
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      const flags: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(parsed)) if (typeof v === "boolean") flags[k] = v;
      uiFlags.set(prev => ({ ...flags, ...prev }));
    }).catch(() => {});
  }, []);
  const value = useSyncExternalStore(uiFlags.subscribe, () => uiFlags.get()[id] ?? fallback, () => uiFlags.get()[id] ?? fallback);
  return [value, (next: boolean) => setUiFlag(id, next)];
}

export function setUiFlag(id: string, value: boolean): void {
  uiFlags.set(prev => ({ ...prev, [id]: value }));
  void AsyncStorage.setItem(FLAGS_KEY, JSON.stringify(uiFlags.get())).catch(() => {});
}
