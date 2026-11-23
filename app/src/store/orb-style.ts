import AsyncStorage from "@react-native-async-storage/async-storage";
import { createStore } from "./createStore";

const KEY = "dash.appearance.orb";
export const orbStyles = [
  { id: "sphere", label: "Thinking sphere" },
  { id: "rings", label: "Thinking rings" },
  { id: "face", label: "Bot face" },
] as const;
export type OrbStyle = (typeof orbStyles)[number]["id"];
export const orbStyle = createStore<OrbStyle>("sphere");

export async function hydrateOrbStyle() {
  const value = await AsyncStorage.getItem(KEY).catch(() => null);
  const saved = orbStyles.find(({ id }) => id === value);
  if (saved) orbStyle.set(saved.id);
}

export function setOrbStyle(value: OrbStyle) {
  orbStyle.set(value);
  void AsyncStorage.setItem(KEY, value).catch(() => {});
}
