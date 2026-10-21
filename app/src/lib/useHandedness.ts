import { useMemo } from "react";
import { saveSettings, store } from "../store/app";
import { parseHandedness, resolveHandedness, thumbLayout, type Handedness } from "./handedness";

export function setHandedness(preference: Handedness): void {
  const settings = store.get().settings;
  if (settings) saveSettings({ ...settings, handedness: preference });
}

export function toggleHandedness(): void {
  const preference = parseHandedness(store.get().settings?.handedness);
  setHandedness(resolveHandedness(preference) === "right" ? "left" : "right");
}

export function useHandedness() {
  const preference = store.use(s => parseHandedness(s.settings?.handedness));
  // Expo Go on iOS/Android and the web do not expose a system handedness preference.
  // Do not infer it from locale, RTL, pointer type, or screen orientation.
  const side = resolveHandedness(preference);
  return useMemo(() => ({ ...thumbLayout(side), preference }), [preference, side]);
}
