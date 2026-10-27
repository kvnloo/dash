import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, Text, type PressableProps } from "react-native";
import { colors, glass, radius, type } from "../theme";
export function PrimaryButton({ label, ...props }: PressableProps & { label: string }) {
  return <Pressable {...props} accessibilityRole="button" accessibilityLabel={props.accessibilityLabel ?? label} style={({ pressed }) => [styles.wrap, props.disabled && styles.disabled, pressed && styles.pressed]}>
    <LinearGradient colors={[colors.actionStrong, colors.accent]} style={styles.fill}><Text style={styles.text}>{label}</Text></LinearGradient>
  </Pressable>;
}
const styles = StyleSheet.create({
  wrap: { borderRadius: radius.pill, overflow: "hidden", marginTop: 12 },
  fill: { minHeight: 52, paddingHorizontal: 24, alignItems: "center", justifyContent: "center", borderTopWidth: 1, borderColor: glass.spec, borderRadius: radius.pill },
  text: { ...type.heading, color: colors.onAccent }, disabled: { opacity: .42 }, pressed: { transform: [{ scale: .98 }] },
});
