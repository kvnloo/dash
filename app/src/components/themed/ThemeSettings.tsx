import { Pressable, StyleSheet, Text, View } from "react-native";
import { GlassSurface } from "../GlassSurface";
import { haptic } from "../../haptics";
import { THEME_MATERIALS, setThemeMaterial, setThemeMode, themeMode, type ThemeMode } from "../../lib/theme-mode";
import { colors, radius, space, type } from "../../theme";
import { ElementalButton, ElementalPanel, ElementalSegmented } from "./Elemental";

const LABEL: Record<ThemeMode, string> = { night: "Living Night", blueprint: "Blueprint" };
const OPTIONS = (["night", "blueprint"] satisfies ThemeMode[]).map(value => ({ value, label: LABEL[value] }));
const HELP = "Living Night is the default. Blueprint shows the blueprint Living Ruins wallpaper behind Dash, with elemental-ui stone buttons. It takes priority over Wallpaper glass while selected.";

/** Settings card: pick the theme. Themed mode draws the card itself in elemental-ui stone. */
export function ThemeSettings() {
  const { mode, material } = themeMode.use(s => s);
  const choose = (value: ThemeMode) => { setThemeMode(value); haptic.select(); };
  if (mode === "blueprint") return <>
    <Text style={styles.label}>Theme</Text>
    <ElementalPanel style={styles.panel} testID="settings-theme-elemental">
      <ElementalSegmented label="Theme" options={OPTIONS} value={mode} onChange={choose} testID="settings-theme" />
      <Text style={styles.stoneLabel}>Button stone</Text>
      <View style={styles.stones}>
        {THEME_MATERIALS.map(m => <ElementalButton key={m} compact material={m} label={m[0]?.toUpperCase() + m.slice(1)}
          selected={material === m} onPress={() => { setThemeMaterial(m); haptic.select(); }} testID={`elemental-material-${m}`}
          accessibilityLabel={`Button stone ${m}`} style={styles.stone} />)}
      </View>
      <Text style={styles.stoneHelp}>{HELP}</Text>
    </ElementalPanel>
  </>;
  return <>
    <Text style={styles.label}>Theme</Text>
    <GlassSurface variant="surface" borderRadius={radius.md} style={styles.card}>
      <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Theme">
        {OPTIONS.map(o => <Pressable key={o.value}
          accessibilityRole="radio"
          accessibilityLabel={o.label}
          accessibilityState={{ checked: mode === o.value }}
          aria-checked={mode === o.value}
          testID={`settings-theme-${o.value}`}
          onPress={() => choose(o.value)}
          style={[styles.radio, { borderColor: mode === o.value ? colors.gold : colors.border }]}>
          <Text style={{ ...type.body, color: mode === o.value ? colors.gold : colors.textMuted }}>{o.label}</Text>
        </Pressable>)}
      </View>
      <Text style={[styles.help, { padding: space.md }]}>{HELP}</Text>
    </GlassSurface>
  </>;
}

const styles = StyleSheet.create({
  label: { color: colors.text, ...type.cardTitle, marginTop: space.xl, marginBottom: space.sm, marginLeft: space.xs },
  card: { paddingTop: space.md, overflow: "hidden" },
  row: { flexDirection: "row", paddingHorizontal: space.md, gap: space.sm },
  radio: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, borderWidth: 1 },
  help: { ...type.small, color: colors.textMuted },
  panel: { gap: space.md },
  stoneLabel: { ...type.label, color: "#d7c6aa", textTransform: "uppercase" },
  stones: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  stone: { flexGrow: 1 },
  stoneHelp: { ...type.small, color: "#e8ddca" },
});
