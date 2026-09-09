import { BlurView } from "expo-blur";
import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import { glass, radius } from "../theme";

export type GlassVariant = "surface" | "raised" | "chip" | "chipOn";

interface Props extends ViewProps {
  children: ReactNode;
  variant?: GlassVariant;
  borderRadius?: number;
  /** Skip blur on dense UI (chips) — tint + border only. */
  blur?: boolean;
  style?: StyleProp<ViewStyle>;
}

const fillFor: Record<GlassVariant, string> = {
  surface: glass.fill,
  raised: glass.fillRaised,
  chip: glass.fillChip,
  chipOn: glass.fillChipOn,
};

function blurIntensity(): number {
  if (Platform.OS === "ios") return glass.blurIos;
  if (Platform.OS === "android") return glass.blurAndroid;
  return glass.blurWeb;
}

/** Frosted glass panel — black base + subtle refractive edge (Expo Go friendly). */
export function GlassSurface({
  children,
  variant = "surface",
  borderRadius = radius.md,
  blur = true,
  style,
  ...rest
}: Props) {
  const fill = fillFor[variant];
  const bright = variant === "chipOn" || variant === "raised";

  return (
    <View style={[styles.outer, { borderRadius }, style]} {...rest}>
      {blur ? (
        <BlurView intensity={blurIntensity()} tint="dark" style={StyleSheet.absoluteFill} />
      ) : null}
      <View pointerEvents="none" style={[styles.tint, { borderRadius, backgroundColor: fill }]} />
      <View
        pointerEvents="none"
        style={[
          styles.edge,
          {
            borderRadius,
            borderColor: bright ? glass.borderBright : glass.border,
            borderTopColor: glass.highlight,
          },
        ]}
      />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { overflow: "hidden", position: "relative" },
  tint: { ...StyleSheet.absoluteFill },
  edge: { ...StyleSheet.absoluteFill, borderWidth: StyleSheet.hairlineWidth },
  content: { position: "relative" },
});
