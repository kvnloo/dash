/** Single source of truth for preview semantics and its next press target. */
export function largeTypePreviewControl(typeScale: number) {
  if (!Number.isFinite(typeScale) || typeScale <= 0 || !Number.isFinite(typeScale * 100)) {
    return {
      accessibilityLabel: "Large type preview unavailable",
      accessibilityState: { selected: false, disabled: true },
      nextScale: undefined,
    };
  }

  const selected = typeScale !== 1;
  const nextScale = selected ? 1 : 1.6;
  return {
    accessibilityLabel: `Large type preview ${selected ? "on" : "off"}, ${Math.round(typeScale * 100)} percent. Activate to ${selected ? "restore" : "preview"} ${Math.round(nextScale * 100)} percent.`,
    accessibilityState: { selected, disabled: false },
    nextScale,
  };
}
