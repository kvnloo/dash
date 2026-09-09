import { BlurView } from "expo-blur";
import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import { glass, radius } from "../theme";

export type GlassVariant = "surface" | "raised" | "chip" | "chipOn" | "nav";

interface Props extends ViewProps {
  children: ReactNode;
  variant?: GlassVariant;
  borderRadius?: number;
  blur?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}

const fillFor: Record<GlassVariant, string> = {
  surface: glass.fill,
  raised: glass.fillRaised,
  chip: glass.fillChip,
  chipOn: glass.fillChipOn,
  nav: glass.fillNav,
};

function blurIntensity(variant: GlassVariant): number {
  if (variant === "nav") return glass.blurNav;
  if (Platform.OS === "ios") return glass.blurIos;
  if (Platform.OS === "android") return glass.blurAndroid;
  return glass.blurWeb;
}

/** HomeForge `.glass`: sheen gradient + frost + specular top + inset rim + bottom edge. */
export function GlassSurface({
  children,
  variant = "surface",
  borderRadius = radius.md,
  blur = true,
  style,
  contentStyle,
  ...rest
}: Props) {
  const fill = fillFor[variant];
  const nav = variant === "nav";
  const bright = variant === "chipOn" || variant === "raised" || nav;

  return (
    <View style={[styles.outer, { borderRadius }, nav && styles.navShadow, style]} {...rest}>
      {blur ? (
        <BlurView intensity={blurIntensity(variant)} tint="dark" style={StyleSheet.absoluteFill} />
      ) : null}
      <View pointerEvents="none" style={[styles.tint, { borderRadius, backgroundColor: fill }]} />
      {nav ? (
        <>
          <View
            pointerEvents="none"
            style={[styles.sheen, { borderTopLeftRadius: borderRadius, borderTopRightRadius: borderRadius }]}
          />
          <View pointerEvents="none" style={styles.rim} />
          <View pointerEvents="none" style={styles.edge} />
        </>
      ) : null}
      <View
        pointerEvents="none"
        style={[
          styles.stroke,
          {
            borderRadius,
            borderColor: nav ? glass.hair2 : bright ? glass.borderBright : glass.border,
            borderTopColor: nav ? glass.spec : glass.highlight,
          },
        ]}
      />
      <View style={[styles.content, contentStyle]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { overflow: "hidden", position: "relative" },
  navShadow: {
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  tint: { ...StyleSheet.absoluteFillObject },
  sheen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "34%",
    backgroundColor: glass.sheen,
  },
  rim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: glass.rim,
  },
  edge: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 10,
    backgroundColor: glass.edge,
  },
  stroke: { ...StyleSheet.absoluteFillObject, borderWidth: 1 },
  content: { position: "relative", zIndex: 1 },
});
