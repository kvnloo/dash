import { useEffect, useRef } from "react";
import { Image, StyleSheet, View } from "react-native";
import { mountLivingWallpaper, type WallpaperTier } from "../../vendor/blueprint-wallpaper/mount";

/** Served from app/public (copied into the web export root). */
const BASE = "/wallpaper/living-ruins/";
const ASSETS = { base: `${BASE}base.webp`, masks: `${BASE}masks.webp`, flow: `${BASE}flow.webp`, depth: `${BASE}depth.webp` };
/** `?wallpaper=webgl|poster` forces a tier, as on the blueprint site (tests and debugging). */
const FORCED_TIER: WallpaperTier | null = (() => {
  if (typeof location === "undefined") return null;
  const v = new URLSearchParams(location.search).get("wallpaper");
  return v === "webgl" || v === "poster" ? v : null;
})();

/**
 * blueprint's Living Ruins wallpaper: the poster plate always, and the WebGL player over it
 * (water, god-rays, embers, pointer ripples) when the GPU can carry it.
 */
export function BlueprintWallpaper() {
  const host = useRef<View>(null);
  useEffect(() => {
    const element: unknown = host.current;
    if (typeof HTMLElement === "undefined" || !(element instanceof HTMLElement)) return;
    // The host carries data-tier and the canvas data-ready / data-fps (set by mount.ts).
    return mountLivingWallpaper(element, ASSETS, {}, { force: FORCED_TIER });
  }, []);
  return <View pointerEvents="none" aria-hidden style={StyleSheet.absoluteFill} testID="blueprint-wallpaper">
    <Image source={{ uri: ASSETS.base }} resizeMode="cover" style={StyleSheet.absoluteFill} testID="blueprint-wallpaper-poster" />
    <View ref={host} style={StyleSheet.absoluteFill} testID="blueprint-wallpaper-host" />
  </View>;
}
