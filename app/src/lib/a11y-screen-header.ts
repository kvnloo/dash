/** Semantic state for an icon-only header control. Omitted flags stay unknown, not false. */
export type HeaderButtonState = Readonly<{
  disabled?: boolean;
  busy?: boolean;
  selected?: boolean;
  expanded?: boolean;
}>;

export type HeaderButtonModel = Readonly<{
  label: string;
  disabled: boolean;
  accessibilityState: Readonly<{
    disabled: boolean;
    busy?: boolean;
    selected?: boolean;
    expanded?: boolean;
  }>;
}>;

/** Empty labels or missing callbacks cannot produce a silent, actionable icon. */
export function headerButtonModel(
  label: string,
  hasAction: boolean,
  state: HeaderButtonState = {},
): HeaderButtonModel {
  const name = label.trim();
  const disabled = !hasAction || name.length === 0 || state.disabled === true || state.busy === true;
  return {
    label: name || "Unavailable action",
    disabled,
    accessibilityState: {
      disabled,
      ...(state.busy === undefined ? {} : { busy: state.busy }),
      ...(state.selected === undefined ? {} : { selected: state.selected }),
      ...(state.expanded === undefined ? {} : { expanded: state.expanded }),
    },
  };
}

/** Pressable dispatches both touch and accessibility activation through onPress. */
export function invokeHeaderButton(
  model: HeaderButtonModel,
  onPress: (() => void) | undefined,
  feedback: () => void,
): boolean {
  if (model.disabled || !onPress) return false;
  feedback();
  onPress();
  return true;
}
