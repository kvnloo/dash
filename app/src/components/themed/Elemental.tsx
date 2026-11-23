/**
 * elemental-ui (kvnloo/elemental-ui, GPL-3.0-only) tactile stone controls for Dash's themed mode,
 * ported from web/elemental.css to React Native: raised stone surface (procedural basecolor
 * texture, diagonal sheen, top-left highlight, bottom-right shade, drop shadow), hover lift,
 * pressed/`aria-pressed` sink, disabled, keyboard focus ring. Labels stay real text.
 */
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { ImageBackground, Platform, Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { fonts } from "../../theme";
import { ELEMENTAL_TEXTURES } from "./elemental-textures.generated";

export type ElementalMaterial = "basalt" | "slate" | "limestone";
const MATERIAL: Record<ElementalMaterial, { id: string; bg: string; fg: string; fallback: [string, string, string] }> = {
  basalt: { id: "geo.basalt.vesicular.v1", bg: "#282829", fg: "#f8eee0", fallback: ["#343536", "#17191a", "#313438"] },
  slate: { id: "geo.slate.layered.v1", bg: "#353a3d", fg: "#f3eee5", fallback: ["#303538", "#434b4e", "#272d30"] },
  limestone: { id: "geo.limestone.porous.v1", bg: "#c4b198", fg: "#241a17", fallback: ["#e4d8c4", "#baa88b", "#baa88b"] },
};
export const ELEMENTAL_FOCUS = "#ffbd53";

function StoneFace({ material, radius, sunk, children }: { material: ElementalMaterial; radius: number; sunk: boolean; children?: ReactNode }) {
  const m = MATERIAL[material];
  const texture = ELEMENTAL_TEXTURES[m.id];
  return <View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden", backgroundColor: m.bg }]} pointerEvents="none" testID="elemental-stone">
    <LinearGradient colors={m.fallback} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
    {texture ? <ImageBackground source={{ uri: texture }} resizeMode="cover" style={StyleSheet.absoluteFill} /> : null}
    <LinearGradient colors={sunk ? ["rgba(0,0,0,.42)", "rgba(0,0,0,.12)", "rgba(0,0,0,.20)"] : ["rgba(255,255,255,.11)", "rgba(255,255,255,0)", "rgba(0,0,0,.30)"]}
      locations={[0, .43, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
    <View style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 1, borderColor: "rgba(10,10,10,.22)",
      borderTopColor: sunk ? "rgba(0,0,0,.45)" : "rgba(255,255,255,.16)", borderLeftColor: sunk ? "rgba(0,0,0,.40)" : "rgba(255,255,255,.12)",
      borderBottomColor: sunk ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.30)", borderRightColor: sunk ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.28)" }]} />
    {children}
  </View>;
}

export function ElementalButton({ label, onPress, material = "basalt", selected, disabled, testID, accessibilityLabel, style, compact }: {
  label: string; onPress?: PressableProps["onPress"]; material?: ElementalMaterial; selected?: boolean; disabled?: boolean;
  testID?: string; accessibilityLabel?: string; style?: StyleProp<ViewStyle>; compact?: boolean;
}) {
  const m = MATERIAL[material];
  return <Pressable
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel ?? label}
    accessibilityState={{ disabled: Boolean(disabled), ...(selected === undefined ? {} : { selected }) }}
    aria-pressed={selected}
    testID={testID}
    style={state => {
      const hovered = "hovered" in state && state.hovered === true;
      const focused = "focused" in state && state.focused === true;
      const sunk = state.pressed || selected === true;
      return [styles.button, compact && styles.compact, disabled && styles.disabled,
        { transform: [{ translateY: disabled ? 0 : sunk ? 2 : hovered ? -2 : 0 }] },
        sunk ? styles.sunkShadow : styles.raisedShadow,
        focused && Platform.OS === "web" ? styles.focus : null, style];
    }}>
    {state => <>
      <StoneFace material={material} radius={15} sunk={state.pressed || selected === true} />
      <Text style={[styles.label, compact && styles.labelCompact, { color: m.fg }]} numberOfLines={1}>{label}</Text>
    </>}
  </Pressable>;
}

export function ElementalPanel({ children, material = "slate", style, testID }: { children: ReactNode; material?: ElementalMaterial; style?: StyleProp<ViewStyle>; testID?: string }) {
  return <View style={[styles.panel, styles.raisedShadow, style]} testID={testID}>
    <StoneFace material={material} radius={20} sunk={false} />
    {children}
  </View>;
}

/** elemental-ui `.el-segmented` + `.el-choice`: an inset tray of choices, the chosen one sunk. */
export function ElementalSegmented<T extends string>({ options, value, onChange, testID, label }: {
  options: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void; testID?: string; label: string;
}) {
  return <View style={styles.tray} accessibilityRole="radiogroup" accessibilityLabel={label} testID={testID}>
    {options.map(o => {
      const on = o.value === value;
      return <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="radio" accessibilityLabel={o.label}
        accessibilityState={{ checked: on }} aria-checked={on} testID={testID ? `${testID}-${o.value}` : undefined}
        style={state => [styles.choice, on && styles.choiceOn, "focused" in state && state.focused === true && Platform.OS === "web" ? styles.focus : null]}>
        <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{o.label}</Text>
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  button: { minHeight: 48, minWidth: 44, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  compact: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 8 },
  label: { fontFamily: fonts.editorial, fontSize: 19, lineHeight: 23, fontWeight: "500" },
  labelCompact: { fontSize: 16, lineHeight: 20 },
  disabled: { opacity: .46 },
  raisedShadow: { shadowColor: "#110f0d", shadowOpacity: .35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  sunkShadow: { shadowColor: "#000", shadowOpacity: .2, shadowRadius: 1, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  focus: { outlineColor: ELEMENTAL_FOCUS, outlineWidth: 3, outlineStyle: "solid", outlineOffset: 4 },
  panel: { borderRadius: 20, padding: 16, overflow: "visible" },
  tray: { flexDirection: "row", flexWrap: "wrap", gap: 4, padding: 7, borderRadius: 18, backgroundColor: "rgba(0,0,0,.28)",
    borderWidth: 1, borderTopColor: "rgba(0,0,0,.45)", borderLeftColor: "rgba(0,0,0,.35)", borderBottomColor: "rgba(255,255,255,.10)", borderRightColor: "rgba(255,255,255,.08)" },
  choice: { minHeight: 44, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, alignItems: "center", justifyContent: "center", flexGrow: 1 },
  choiceOn: { backgroundColor: "#242627", borderWidth: 1, borderTopColor: "rgba(0,0,0,.6)", borderBottomColor: "rgba(255,255,255,.3)", borderLeftColor: "rgba(0,0,0,.5)", borderRightColor: "rgba(0,0,0,.4)" },
  choiceText: { fontFamily: fonts.editorial, fontSize: 17, lineHeight: 21, color: "#d7c6aa" },
  choiceTextOn: { color: "#f3eee5" },
});
