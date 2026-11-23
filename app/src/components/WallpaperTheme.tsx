import { LinearGradient } from "expo-linear-gradient";
import { createContext, useContext, useEffect, useState } from "react";
import { AppState, Platform, StyleSheet, View } from "react-native";
import { setWallpaperWindow } from "../lib/wallpaper-window";
import { appearanceTheme, hydrateAppearanceTheme } from "../store/appearance";
import { wallpaperScrim } from "../theme";

export const WallpaperTheme = createContext(false);
export const useWallpaperGlass = () => useContext(WallpaperTheme);

export function useWallpaperWindow(allowSystemWallpaper: boolean) {
  const enabled = appearanceTheme.use(theme => theme === "wallpaper") && allowSystemWallpaper;
  const [ready, setReady] = useState(false);
  useEffect(() => { void hydrateAppearanceTheme(); }, []);
  useEffect(() => {
    let current = true;
    const sync = () => {
      void setWallpaperWindow(enabled).then(active => {
        if (current) setReady(active);
      }).catch(() => { if (current) setReady(false); });
    };
    sync();
    const sub = AppState.addEventListener("change", state => { if (state === "active") sync(); });
    return () => { current = false; sub.remove(); };
  }, [enabled]);
  return ready && enabled;
}

export function WallpaperBackdrop() {
  return <>
    {Platform.OS === "web" ? <LinearGradient pointerEvents="none" colors={["#806327", "#285754", "#43476d"]} style={StyleSheet.absoluteFill} /> : null}
    <View pointerEvents="none" testID="wallpaper-glass-scrim" style={[StyleSheet.absoluteFill, { backgroundColor: wallpaperScrim }]} />
  </>;
}
