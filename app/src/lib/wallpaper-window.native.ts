import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

const wallpaper = Platform.OS === "android" && Number(Platform.Version) >= 34
  ? requireOptionalNativeModule<{ setEnabled(enabled: boolean): Promise<boolean> }>("DashWallpaper")
  : null;

export const wallpaperAvailable = wallpaper !== null;
export async function setWallpaperWindow(enabled: boolean): Promise<boolean> {
  return wallpaper ? wallpaper.setEnabled(enabled) : false;
}
