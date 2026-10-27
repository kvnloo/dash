import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet } from "react-native";
import { colors } from "../theme";
import { useGlassScene } from "../store/glass";
/** A quiet vertical wash, never a glowing panel. */
export function Canvas() {
  const scene = useGlassScene();
  // Glass: the root already tints the wallpaper; add only a scrim under header and dock text.
  if (scene.active) return <LinearGradient pointerEvents="none" colors={[scene.scrimTop, "transparent", scene.scrimBottom]} locations={[0, .35, 1]} style={StyleSheet.absoluteFill} />;
  return <LinearGradient pointerEvents="none" colors={[colors.surfaceRaised, colors.bg]} locations={[0, .55]} style={StyleSheet.absoluteFill} />;
}
