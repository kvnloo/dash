import { createStore } from "../store/createStore";

/** Remote-controllable UI overrides (null = screen uses local state). */
export interface DebugUiState {
  mainSearchQuery: string | null;
  chatHarnessPickerOpen: boolean | null;
  /** Set true once debug bootstrap + optional scenario finished. */
  ready: boolean;
}

export const debugUi = createStore<DebugUiState>({
  mainSearchQuery: null,
  chatHarnessPickerOpen: null,
  ready: false,
});

export function resetDebugUi(): void {
  debugUi.set({
    mainSearchQuery: null,
    chatHarnessPickerOpen: null,
    ready: false,
  });
}
