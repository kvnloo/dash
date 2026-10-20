import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type ViewProps } from "react-native";
import { glass, radius } from "../theme";
export type GlassVariant = "surface" | "raised" | "chip" | "chipOn" | "nav";
interface Props extends ViewProps { children: ReactNode; variant?: GlassVariant; borderRadius?: number; blur?: boolean; contentStyle?: ViewProps["style"] }
/** Blur is opt-in: Android gets at most header, dock and composer, never list cards. */
export function GlassSurface({ children, variant = "surface", borderRadius = radius.md, blur = false, style, contentStyle, ...rest }: Props) {
  const fill = variant === "raised" ? glass.fillRaised : variant === "chipOn" ? glass.fillNavStrong : glass.fill;
  const intensity = Platform.OS === "ios" ? glass.blurIos : Platform.OS === "android" ? glass.blurAndroid : glass.blurWeb;
  return <View {...rest} style={[styles.outer, { borderRadius }, style]}>
    {blur ? <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} /> : null}
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} />
    <LinearGradient pointerEvents="none" colors={[glass.sheen, "transparent"]} style={StyleSheet.absoluteFill} />
    <View pointerEvents="none" style={[styles.stroke, { borderRadius }]} />
    <View style={contentStyle}>{children}</View>
  </View>;
}
const styles = StyleSheet.create({ outer: { position: "relative", overflow: "hidden", shadowColor: "#000", shadowOpacity: .35, shadowRadius: 15, shadowOffset: { width: 0, height: 8 }, elevation: 6 }, stroke: { ...StyleSheet.absoluteFill, borderWidth: 1, borderColor: glass.hair, borderTopColor: glass.highlight } });
