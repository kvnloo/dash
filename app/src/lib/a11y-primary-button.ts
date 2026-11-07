import type { PressableProps } from "react-native";

export type PrimaryButtonA11yInput = {
  label: string;
  accessibilityLabel?: PressableProps["accessibilityLabel"];
  accessibilityRole?: PressableProps["accessibilityRole"];
  accessibilityState?: PressableProps["accessibilityState"];
  disabled?: PressableProps["disabled"];
  loading?: boolean;
};

/** Keep screen-reader state aligned with the actual pressable target. */
export function primaryButtonA11y({
  label,
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
  disabled,
  loading,
}: PrimaryButtonA11yInput) {
  const busy = loading === true || accessibilityState?.busy === true;
  const isDisabled = disabled === true || accessibilityState?.disabled === true || busy;

  return {
    accessibilityLabel: accessibilityLabel ?? label,
    accessibilityRole: accessibilityRole ?? "button",
    accessibilityState: {
      ...accessibilityState,
      busy,
      disabled: isDisabled,
    },
    disabled: isDisabled,
  };
}
