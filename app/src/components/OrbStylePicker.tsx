import { Pressable, StyleSheet, Text, View } from "react-native";
import { orbStyle, orbStyles, setOrbStyle } from "../store/orb-style";
import { colors, glass, radius, space, type } from "../theme";
import { AgentOrb } from "./AgentOrb";

export function OrbStylePicker() {
  const selected = orbStyle.use(value => value);
  return <View accessibilityRole="radiogroup" accessibilityLabel="Orb style" style={styles.row}>
    {orbStyles.map(({ id, label }) => <Pressable key={id} accessibilityRole="radio" accessibilityLabel={label}
      aria-checked={selected === id} onPress={() => setOrbStyle(id)}
      style={[styles.option, selected === id && styles.selected]}>
      <AgentOrb variant={id} thinking={{ phase: "thinking" }} size={28} animated={false} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>)}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  option: { flexGrow: 1, alignItems: "center", padding: space.sm, gap: space.xs, borderWidth: 1, borderColor: glass.hair, borderRadius: radius.md, backgroundColor: glass.fill },
  selected: { borderColor: colors.accent, backgroundColor: glass.fillNavStrong },
  label: { ...type.small, color: colors.text },
});
