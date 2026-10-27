import type { DraftAttachment } from "../lib/attachments";
import { createStore } from "../store/createStore";
import type { Z0LiveState } from "../../../shared/z0live-state";
import type { CutoutReading, HostSessionReading } from "../lib/chat-window";
import type { VoiceState } from "../lib/continuous-voice";

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
  /** Screenshot fixture for the Voice view's z0live call (replaces the bridge poll). */
  z0liveFixture?: Z0LiveState | null;
  /** SYNTHETIC DisplayCutout reading for web proofs of the cut-out pill (never a device value). */
  cutoutFixture?: CutoutReading | null;
  /** SYNTHETIC host session reading (model/provider/lineage) for web proofs of the badge. */
  hostSessionFixture?: HostSessionReading | null;
  /** SYNTHETIC Dash continuous-voice state for rendered proofs; replaces only what the UI shows, never the mic. */
  voiceStateFixture?: VoiceState | null;
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
