import { Pressable, StyleSheet, Text, View } from "react-native";
import { haptic } from "../haptics";
import { BLUR_STEP, GLASS_PRESETS, TINT_STEP, presetOf, type GlassPresetName, type ThemeMode } from "../lib/glass-theme";
import { setGlassPrefs, useBlurAvailable, useGlassPrefs } from "../store/glass";
import { colors, glassBuild, radius, space, type } from "../theme";
import { GlassSurface } from "./GlassSurface";

const MODES: readonly ThemeMode[] = ["classic", "glass"];
const PRESETS: readonly GlassPresetName[] = ["clear", "frosted", "deep"];
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Choice({ label, text = label, selected, onPress, role = "radio" }: { label: string; text?: string; selected: boolean; onPress(): void; role?: "radio" | "button" }) {
  return <Pressable accessibilityRole={role} accessibilityLabel={label} accessibilityState={{ selected }} onPress={() => { onPress(); haptic.select(); }}
    style={[styles.choice, selected && styles.choiceOn]}>
    <Text style={[styles.choiceText, selected && styles.choiceTextOn]}>{text}</Text>
  </Pressable>;
}

function Stepper({ label, value, onStep }: { label: string; value: string; onStep(dir: -1 | 1): void }) {
  return <View style={styles.stepRow}>
    <Text style={styles.stepLabel}>{label}</Text>
    <Choice role="button" label={`Less ${label.toLowerCase()}`} text="−" selected={false} onPress={() => onStep(-1)} />
    <Text style={styles.stepValue} accessibilityLabel={`${label} ${value}`}>{value}</Text>
    <Choice role="button" label={`More ${label.toLowerCase()}`} text="+" selected={false} onPress={() => onStep(1)} />
  </View>;
}

/** Settings → Appearance. Rendered only in the DASH_GLASS build; the classic build has no theme choice. */
export function GlassThemePicker() {
  const prefs = useGlassPrefs();
  const blurAvailable = useBlurAvailable();
  if (!glassBuild) return null;
  const preset = presetOf(prefs);
  const glass = prefs.mode === "glass";
  return <GlassSurface variant="surface" borderRadius={radius.md} style={styles.card}>
    <Text style={styles.heading}>Theme</Text>
    <View style={styles.row}>{MODES.map(m => <Choice key={m} label={title(m)} selected={prefs.mode === m} onPress={() => setGlassPrefs({ mode: m })} />)}</View>
    {glass ? <>
      <Text style={styles.heading}>Glass</Text>
      <View style={styles.row}>{PRESETS.map(p => <Choice key={p} label={title(p)} selected={preset === p} onPress={() => setGlassPrefs(GLASS_PRESETS[p])} />)}</View>
      <Stepper label="Tint" value={`${Math.round(prefs.tint * 100)}%`} onStep={d => setGlassPrefs({ tint: prefs.tint + d * TINT_STEP })} />
      <Stepper label="Blur" value={`${prefs.blur}dp`} onStep={d => setGlassPrefs({ blur: prefs.blur + d * BLUR_STEP })} />
      <Text style={styles.help}>{blurAvailable === false
        ? "System window blur is off (battery saver, or not supported). Tint only; it is raised a little to keep text readable."
        : "Your wallpaper shows through, blurred by the system. Tint never goes below the level that keeps body text readable."}</Text>
    </> : null}
  </GlassSurface>;
}

const styles = StyleSheet.create({
  card: { paddingVertical: space.sm, marginBottom: space.md },
  heading: { ...type.label, color: colors.textMuted, paddingHorizontal: space.md, paddingTop: space.sm },
  row: { flexDirection: "row", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  choice: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  choiceOn: { borderColor: colors.gold },
  choiceText: { ...type.body, color: colors.textMuted },
  choiceTextOn: { color: colors.gold },
  stepRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.xs },
  stepLabel: { ...type.body, color: colors.text, width: 48 },
  stepValue: { ...type.mono, color: colors.text, width: 52, textAlign: "center" },
  help: { ...type.small, color: colors.textMuted, padding: space.md },
});
