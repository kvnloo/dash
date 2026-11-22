import { StyleSheet, View } from "react-native";
import { BlueprintWallpaper } from "./BlueprintWallpaper";

/** Themed mode root layer: the blueprint wallpaper and a readability veil, under every screen. */
export function ThemedBackdrop() {
  return <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="themed-backdrop">
    <BlueprintWallpaper />
    <View style={[StyleSheet.absoluteFill, styles.veil]} testID="themed-veil" />
  </View>;
}
const styles = StyleSheet.create({ veil: { backgroundColor: "rgba(8,9,8,0.52)" } });
