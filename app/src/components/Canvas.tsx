import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet } from "react-native";
import { colors } from "../theme";
/** A quiet vertical wash, never a glowing panel. */
export function Canvas() {
  return <LinearGradient pointerEvents="none" colors={[colors.surfaceRaised, colors.bg]} locations={[0, .55]} style={StyleSheet.absoluteFill} />;
}
