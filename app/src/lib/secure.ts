import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Keychain / Keystore on device. Web has neither, so fall back to localStorage.
const secure = Platform.OS !== "web";

export function getSecret(key: string): Promise<string | null> {
  return secure ? SecureStore.getItemAsync(key) : AsyncStorage.getItem(key);
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (value.length === 0) {
    await (secure ? SecureStore.deleteItemAsync(key) : AsyncStorage.removeItem(key));
    return;
  }
  await (secure ? SecureStore.setItemAsync(key, value) : AsyncStorage.setItem(key, value));
}
