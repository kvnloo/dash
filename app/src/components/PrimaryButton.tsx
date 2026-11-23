import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, Text, type PressableProps } from "react-native";
import { primaryButtonA11y } from "../lib/a11y-primary-button";
import { colors, glass, radius, type } from "../theme";
import { themeMode } from "../lib/theme-mode";
import { ElementalButton } from "./themed/Elemental";

type PrimaryButtonProps = PressableProps & { label: string; loading?: boolean };

export function PrimaryButton({
  label,
  loading,
  disabled,
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
  style,
  ...rest
}: PrimaryButtonProps) {
  const a11y = primaryButtonA11y({
    label,
    loading,
    disabled,
    accessibilityLabel,
    accessibilityRole,
    accessibilityState,
  });
  const stone = themeMode.use(s => s.mode === "blueprint" ? s.material : null);
  // Themed mode: the same action as an elemental-ui stone button.
  if (stone) {
    return <ElementalButton label={label} material={stone} disabled={a11y.disabled} accessibilityLabel={a11y.accessibilityLabel}
      onPress={rest.onPress} testID={rest.testID} style={styles.stone} />;
  }

  return (
    <Pressable
      {...rest}
      disabled={a11y.disabled}
      accessibilityLabel={a11y.accessibilityLabel}
      accessibilityRole={a11y.accessibilityRole}
      accessibilityState={a11y.accessibilityState}
      style={(state) => [
        styles.wrap,
        a11y.disabled && styles.disabled,
        state.pressed && !a11y.disabled && styles.pressed,
        typeof style === "function" ? style(state) : style,
        styles.minTarget,
      ]}
    >
      <LinearGradient colors={[colors.actionStrong, colors.accent]} style={styles.fill}>
        <Text allowFontScaling style={styles.text}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.pill, overflow: "hidden", marginTop: 12 },
  minTarget: { minHeight: 44, minWidth: 44 },
  fill: { minHeight: 52, paddingHorizontal: 24, alignItems: "center", justifyContent: "center", borderTopWidth: 1, borderColor: glass.spec, borderRadius: radius.pill },
  text: { ...type.heading, color: colors.onAccent },
  disabled: { opacity: .42 },
  pressed: { transform: [{ scale: .98 }] },
  stone: { marginTop: 12 },
});
