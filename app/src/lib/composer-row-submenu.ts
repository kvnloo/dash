/** Pure option and gesture routing for composer action menu row submenus. */
export type ComposerRowOption = {
  id: string;
  label: string;
  run(): void;
  selected?: boolean;
};

export type ComposerMenuRowShape = {
  id: string;
  label: string;
  value: string;
  run(): void;
  values?: readonly string[];
  index?: number;
  inspect?(index: number): void;
  /** Optional explicit actions for hosts with a model/profile/mode picker. */
  options?: readonly ComposerRowOption[];
};

export type ComposerRowChoice = {
  id: string;
  label: string;
  selected: boolean;
  run(): void;
};

export const MENU_ROW_HEIGHT = 48;

/** Never invent model/profile/pen options: only expose actions the host supplied. */
export function submenuChoices(row: ComposerMenuRowShape): ComposerRowChoice[] {
  if (row.options?.length) {
    return row.options.map(option => ({
      id: option.id,
      label: option.label,
      selected: option.selected === true,
      run: option.run,
    }));
  }
  if (row.values?.length && row.inspect) {
    const inspect = row.inspect;
    return row.values.map((label, index) => ({
      id: row.id + ":" + index,
      label,
      selected: index === row.index,
      run: () => inspect(index),
    }));
  }
  // A row that only has a primary action still has a truthful secondary menu.
  return [{ id: row.id + ":open", label: "Open " + row.label, selected: false, run: row.run }];
}

/** The row occupies 0..48; its dropdown starts directly below at y=48. */
export function submenuIndex(y: number, optionCount: number, rowHeight = MENU_ROW_HEIGHT): number {
  "worklet";
  if (!Number.isFinite(y) || !Number.isFinite(rowHeight) || rowHeight <= 0 || optionCount <= 0 || y < rowHeight) return -1;
  const index = Math.floor((y - rowHeight) / rowHeight);
  return index < optionCount ? index : -1;
}

/** Tap and long press are separate gesture winners; never infer tap from a failed hold. */
export function rowGestureActions(row: ComposerMenuRowShape, callbacks: { open(): void; close(): void }) {
  const choices = submenuChoices(row);
  return {
    tap(): void {
      callbacks.close();
      row.run();
    },
    hold(): void {
      callbacks.open();
    },
    choose(index: number): boolean {
      const choice = choices[index];
      if (!choice) return false;
      callbacks.close();
      choice.run();
      return true;
    },
  };
}
