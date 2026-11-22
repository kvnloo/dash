import AsyncStorage from "@react-native-async-storage/async-storage";
import { createStore } from "./createStore";

const KEY = "dash.appearance.theme";
type AppearanceTheme = "night" | "wallpaper";
export const appearanceTheme = createStore<AppearanceTheme>("night");

export async function hydrateAppearanceTheme() {
  const saved = await AsyncStorage.getItem(KEY).catch(() => null);
  if (saved === "wallpaper") appearanceTheme.set(saved);
}

export function setAppearanceTheme(value: AppearanceTheme) {
  appearanceTheme.set(value);
  void AsyncStorage.setItem(KEY, value).catch(() => {});
}
