/**
 * Screen-reader contract for a single harness row.
 *
 * Validate even when a bridge payload is incomplete: an unavailable row must
 * never expose an actionable target that the regular touch path cannot use.
 * No React Native dependency, so the decision can be unit-tested with Bun.
 */
export interface HarnessPickerRowA11y {
  id: string | null;
  name: string;
  label: string;
  hint: string;
  disabled: boolean;
  state: {
    selected: boolean;
    disabled: boolean;
  };
}

export function harnessPickerRowA11y(harness: unknown, selected: string): HarnessPickerRowA11y {
  const idValue = harness !== null && typeof harness === "object" && "id" in harness
    ? harness.id
    : undefined;
  const nameValue = harness !== null && typeof harness === "object" && "name" in harness
    ? harness.name
    : undefined;
  const available = harness !== null && typeof harness === "object" && "available" in harness
    && harness.available === true;

  // Keep the original opaque id for onSelect; trimming it would change identity.
  const id = typeof idValue === "string" && idValue.trim().length > 0 ? idValue : null;
  const givenName = typeof nameValue === "string" ? nameValue.trim() : "";
  const name = givenName || "Unknown harness";
  const disabled = !available || id === null || givenName.length === 0;
  const isSelected = id !== null && id === selected;
  const hint = id === null
    ? "Harness identifier missing"
    : givenName.length === 0
      ? "Harness name missing"
      : !available
        ? "Not installed on the bridge machine"
        : "Select harness and close picker";

  return {
    id,
    name,
    label: disabled ? `${name}, unavailable` : name,
    hint,
    disabled,
    state: { selected: isSelected, disabled },
  };
}

/**
 * One activation path for touch and the native accessibility "activate"
 * gesture, which React Native Pressable delivers as onPress.
 */
export function activateHarnessPickerRow(
  row: HarnessPickerRowA11y,
  onSelect: (id: string) => void,
  onClose: () => void,
): boolean {
  if (row.disabled || row.id === null) return false;
  onSelect(row.id);
  onClose();
  return true;
}
