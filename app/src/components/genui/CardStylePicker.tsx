import { Pressable, StyleSheet, Text, View } from "react-native";
import { haptic } from "../../haptics";
import { cardStyle, setCardStyle, type CardStyle } from "../../store/card-style";
import { colors, controlMin, radius, space, type } from "../../theme";

const options: { value: CardStyle; label: string }[] = [
  { value: "dash", label: "Dash" },
  { value: "app", label: "App" },
];

export function CardStylePicker() {
  const choice = cardStyle.use(value => value);
  return <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Card style">
    <Text style={styles.label}>Card style</Text>
    <View style={styles.options}>
      {options.map(({ value, label }) => (
        <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: value === choice }} aria-checked={value === choice}
          onPress={() => { setCardStyle(value); haptic.select(); }}
          style={[styles.option, value === choice && styles.selected]}>
          <Text style={[styles.label, value === choice && styles.selectedText]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  options: { flexDirection: "row", gap: space.xs },
  option: { minHeight: controlMin, minWidth: 64, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  selected: { borderColor: colors.gold, backgroundColor: colors.surface },
  label: { ...type.body, color: colors.text },
  selectedText: { color: colors.gold },
});
