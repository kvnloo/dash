/** Pure layout, accessibility and one-shot selection rules for the shared bottom sheet. */
export interface BottomActionOption {
  id: string;
  label: string;
  accessibilityLabel: string;
  destructive: boolean;
}

export interface SheetLayout {
  height: number;
  scrollable: boolean;
}

export interface SheetAccessibility extends BottomActionOption {
  accessibilityHint?: string;
  position: number;
  total: number;
}

export interface SheetSelection {
  open: boolean;
  selectedId: string | null;
}

export const SHEET_ROW_HEIGHT = 52;
export const SHEET_HEADER_HEIGHT = 56;
const MAX_WINDOW_FRACTION = 0.6;

/** The header and bottom safe-area padding remain fixed while the option rows scroll. */
export function sheetLayout(optionCount: number, windowHeight: number, bottomInset: number): SheetLayout {
  const count = Number.isFinite(optionCount) ? Math.max(0, Math.floor(optionCount)) : 0;
  const available = Number.isFinite(windowHeight) ? Math.max(0, windowHeight) : 0;
  const inset = Number.isFinite(bottomInset) ? Math.max(0, bottomInset) : 0;
  const naturalHeight = SHEET_HEADER_HEIGHT + SHEET_ROW_HEIGHT * count + inset;
  const maximumHeight = available * MAX_WINDOW_FRACTION;

  return {
    height: Math.min(naturalHeight, maximumHeight),
    scrollable: naturalHeight > maximumHeight,
  };
}

/** Supply explicit reading order and a separately spoken destructive warning. */
export function sheetA11y(options: readonly BottomActionOption[]): SheetAccessibility[] {
  return options.map((option, index) => ({
    ...option,
    accessibilityLabel: `${option.accessibilityLabel.trim() || option.label}, ${index + 1} of ${options.length}`,
    accessibilityHint: option.destructive ? "Destructive action" : undefined,
    position: index + 1,
    total: options.length,
  }));
}

/** One selection consumes the open state; subsequent presses cannot dispatch again. */
export function selectAndClose(
  state: SheetSelection,
  id: string,
  options: readonly BottomActionOption[],
): SheetSelection {
  if (!state.open || !options.some(option => option.id === id)) return state;
  return { open: false, selectedId: id };
}
