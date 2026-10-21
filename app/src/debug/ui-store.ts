import type { DraftAttachment } from "../lib/attachments";
import { createStore } from "../store/createStore";

/** Remote-controllable UI overrides (null = screen uses local state). */
export interface DebugUiState {
  mainSearchQuery: string | null;
  mainTabIndex: number | null;
  chatHarnessPickerOpen: boolean | null;
  /** Fixture chips for the composer (screenshots only; nothing is uploaded). */
  chatComposerAttachments: DraftAttachment[] | null;
  /** Set true once debug bootstrap + optional scenario finished. */
  ready: boolean;
  orchestraFixture?: boolean;
}

export const debugUi = createStore<DebugUiState>({
  mainSearchQuery: null,
  mainTabIndex: null,
  chatHarnessPickerOpen: null,
  chatComposerAttachments: null,
  ready: false,
});

export function resetDebugUi(): void {
  debugUi.set({
    mainSearchQuery: null,
    mainTabIndex: null,
    chatHarnessPickerOpen: null,
    chatComposerAttachments: null,
    ready: false,
  });
}
