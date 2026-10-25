import { createContext, forwardRef, useContext, useMemo, useState, type ComponentRef, type ReactNode } from "react";
import { StyleSheet, Text, View, useWindowDimensions, type TextProps } from "react-native";
import Animated from "react-native-reanimated";
import { componentSizing, DENSITIES, type Density } from "../lib/tile-layout";
import { largeTypePreviewControl } from "../lib/a11y-density";
import { colors, fonts } from "../theme";
import { PressScale } from "./PressScale";

const DensityContext = createContext<{ density: Density; setDensity(value: Density): void; typeScale: number; setTypeScale(value: number): void }>({ density: "comfortable", setDensity: () => {}, typeScale: 1, setTypeScale: () => {} });

export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensity] = useState<Density>("comfortable");
  const [typeScale, setTypeScale] = useState(1);
  const value = useMemo(() => ({ density, setDensity, typeScale, setTypeScale }), [density, typeScale]);
  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

export function useDensity() {
  const { density, setDensity, typeScale, setTypeScale } = useContext(DensityContext);
  const { fontScale } = useWindowDimensions();
  return { density, setDensity, typeScale, setTypeScale, fontScale: fontScale * typeScale, sizing: componentSizing(density, fontScale * typeScale) };
}

/** Lab preview multiplies the same typography used in native, on top of system font scale. */
export const DensityText = forwardRef<ComponentRef<typeof Text>, TextProps>(function DensityText({ style, ...props }, ref) {
  const { typeScale } = useContext(DensityContext);
  const flat = StyleSheet.flatten(style);
  return <Text ref={ref} {...props} style={[style, typeScale !== 1 && { fontSize: (flat?.fontSize ?? 14) * typeScale, ...(flat?.lineHeight ? { lineHeight: flat.lineHeight * typeScale } : {}) }]} />;
});

export const DensityAnimatedText = Animated.createAnimatedComponent(DensityText);

export function DensityPicker() {
  const { density, setDensity, typeScale, setTypeScale } = useDensity();
  const preview = largeTypePreviewControl(typeScale);
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 16, paddingVertical: 8 }} accessibilityLabel="Information density">
    {DENSITIES.map(value => <PressScale key={value} onPress={() => setDensity(value)} accessibilityRole="button" accessibilityLabel={`${value} density`} accessibilityState={{ selected: density === value }} accessibilityHint={density === value ? "Current density" : `Activate to use ${value} density`} testID={`density-${value}`} style={{ minHeight: 44, paddingHorizontal: 12, borderRadius: 24, borderWidth: 1, borderColor: density === value ? colors.text : colors.border, backgroundColor: density === value ? colors.surfaceRaised : colors.bg }}>
      <Text allowFontScaling style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.text }}>{value.charAt(0).toUpperCase() + value.slice(1)}</Text>
    </PressScale>)}
    <PressScale
      onPress={() => { if (preview.nextScale !== undefined) setTypeScale(preview.nextScale); }}
      accessibilityRole="button"
      accessibilityLabel={preview.accessibilityLabel}
      accessibilityState={preview.accessibilityState}
      disabled={preview.accessibilityState.disabled}
      testID="large-type"
      style={{ minHeight: 44, paddingHorizontal: 12 }}
    >
      <Text allowFontScaling style={{ color: colors.textMuted, fontFamily: fonts.mono, fontSize: 11 }}>Aa {preview.accessibilityState.disabled ? "unavailable" : `${Math.round(typeScale * 100)}%`}</Text>
    </PressScale>
  </View>;
}
