import type { DraftAttachment } from "../lib/attachments";
import type { RootStackParamList } from "../navigation";
import type { DebugSeedVariant } from "./seed";
import type { Z0LiveState } from "../../../shared/z0live-state";

export type DebugScenarioId =
  | "main"
  | "main-bots"
  | "main-chats"
  | "main-products"
  | "main-chats-search"
  | "main-orchestra"
  | "orchestra-motion"
  | "chat"
  | "voice"
  | "voice-listening"
  | "voice-speaking"
  | "voice-tool"
  | "approvals"
  | "main-files"
  | "ux-long"
  | "chat-omp"
  | "chat-streaming"
  | "chat-picker"
  | "chat-attachments"
  | "pair"
  | "settings"
  | "orchestra-dash";

export interface DebugScenario {
  id: DebugScenarioId;
  label: string;
  seed: DebugSeedVariant;
  route: { name: keyof RootStackParamList; params?: RootStackParamList[keyof RootStackParamList] };
  ui?: {
    mainSearchQuery?: string;
    orchestraFixture?: boolean;
    mainTabIndex?: number;
    chatHarnessPickerOpen?: boolean;
    activeConversationId?: string;
    chatComposerAttachments?: DraftAttachment[];
    z0liveFixture?: Z0LiveState;
  };
}

export const DEBUG_SCENARIOS: Record<DebugScenarioId, DebugScenario> = {
  "orchestra-motion": { id: "orchestra-motion", label: "Orchestra · local motion fixture", seed: "paired", route: { name: "Main" }, ui: { mainSearchQuery: "", mainTabIndex: 2, orchestraFixture: true } },
  "ux-long": { id: "ux-long", label: "UX qualification transcript", seed: "paired", route: { name: "Chat" }, ui: { activeConversationId: "ux-long" } },
  "main-chats-search": { id: "main-chats-search", label: "Chats — focused search", seed: "paired", route: { name: "Main" }, ui: { mainSearchQuery: "", mainTabIndex: 1 } },
  "main-orchestra": { id: "main-orchestra", label: "Orchestra", seed: "paired", route: { name: "Main" }, ui: { mainSearchQuery: "", mainTabIndex: 2 } },
  chat: { id: "chat", label: "Chat", seed: "paired", route: { name: "Chat" }, ui: { activeConversationId: "demo-omp" } },
  voice: { id: "voice", label: "Voice — microphone off", seed: "paired", route: { name: "Voice" } },
  "voice-listening": { id: "voice-listening", label: "Voice — live call listening", seed: "paired", route: { name: "Voice" }, ui: { z0liveFixture: { live: true, sessionId: "fixture", phase: "listening", muted: false, updated: 0, transcript: [{ role: "user", text: "Can you check whether the gesture recording change went through?" }, { role: "assistant", text: "Yes, it went to the Debug Hermes session. Want me to send it again?" }] } } },
  "voice-speaking": { id: "voice-speaking", label: "Voice — live call speaking", seed: "paired", route: { name: "Voice" }, ui: { z0liveFixture: { live: true, sessionId: "fixture", phase: "speaking", muted: false, updated: 0, transcript: [{ role: "user", text: "Send it again and ask for an ETA." }, { role: "assistant", text: "Sent. I asked Hermes for an ETA and will tell you when it replies." }] } } },
  "voice-tool": { id: "voice-tool", label: "Voice — live call running a tool", seed: "paired", route: { name: "Voice" }, ui: { z0liveFixture: { live: true, sessionId: "fixture", phase: "tool", tool: "ask_z0", muted: false, updated: 0, transcript: [{ role: "assistant", text: "Checking." }, { role: "user", text: "What changed in Dash today?" }] } } },
  approvals: { id: "approvals", label: "Approvals — dry-run fixtures", seed: "paired", route: { name: "Approvals" } },
  main: {
    id: "main",
    label: "Main — Orchestra tab",
    seed: "paired",
    route: { name: "Main" },
    ui: { mainSearchQuery: "", mainTabIndex: 2 },
  },
  "main-bots": {
    id: "main-bots",
    label: "Main — Bots tab",
    seed: "paired",
    route: { name: "Main" },
    ui: { mainSearchQuery: "", mainTabIndex: 0 },
  },
  "main-chats": {
    id: "main-chats",
    label: "Main — Chats tab",
    seed: "paired",
    route: { name: "Main" },
    ui: { mainSearchQuery: "", mainTabIndex: 1 },
  },
  "main-products": {
    id: "main-products",
    label: "Main — Orchestra tab",
    seed: "paired",
    route: { name: "Main" },
    ui: { mainSearchQuery: "", mainTabIndex: 2 },
  },
  "main-files": {
    id: "main-files",
    label: "Main — /file login",
    seed: "paired",
    route: { name: "Main" },
    ui: { mainSearchQuery: "/file login" },
  },
  "chat-omp": {
    id: "chat-omp",
    label: "Chat — OMP thread",
    seed: "paired",
    route: { name: "Chat" },
    ui: { activeConversationId: "demo-omp" },
  },
  "chat-streaming": {
    id: "chat-streaming",
    label: "Chat — Codex streaming",
    seed: "paired",
    route: { name: "Chat" },
    ui: { activeConversationId: "demo-codex" },
  },
  "chat-attachments": {
    id: "chat-attachments",
    label: "Chat — attachments in the composer",
    seed: "paired",
    route: { name: "Chat" },
    ui: {
      activeConversationId: "debug-attach",
      // Fixture chips: one uploaded photo, one uploading text file, one refused video.
      chatComposerAttachments: [
        { key: "fx-1", name: "seedlings.png", mime: "image/png", size: 48_213, uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAA4klEQVR42sXSIXIEIRSE4T1EVET0f4YoFAqFQqGeokZQiCnUUygUCoVCzTFzgNmtrZikqu1nuvvx9fnxqzz+A7gDfxAO4oEcvAG24Aq+EAqxIIVUeAlMxVZcxVdCJVakkiq58gR8K0axilO8EpSoiJKUrJzKDTRMwzZcwzdCIzakkRq5cbY76JiO7biO74RO7EgndXLn7HcwMAM7cAM/CIM4kEEa5ME57mBiJnbiJn4SJnEikzTJk3PyrKWFXbiFX4RFXMgiLfLi9Q4bt/GbsIkb2aTNu6Uv/EW4iBdy8efn+wHoA5P/4Nb2SwAAAABJRU5ErkJggg==", state: "ready", ref: { id: "0123456789abcdef0123456789abcdef", name: "seedlings.png", mime: "image/png", size: 48_213 } },
        { key: "fx-2", name: "watering-log.txt", mime: "text/plain", size: 2_310, uri: "file:///fixture/watering-log.txt", state: "uploading" },
        { key: "fx-3", name: "walkthrough.mov", mime: "video/quicktime", size: 41_000_000, uri: "file:///fixture/walkthrough.mov", state: "error", error: "walkthrough.mov is 39.1 MB. The limit is 25.0 MB per file." },
      ],
    },
  },
  "chat-picker": {
    id: "chat-picker",
    label: "Chat — harness picker open",
    seed: "paired",
    route: { name: "Chat" },
    ui: { activeConversationId: "demo-omp", chatHarnessPickerOpen: true },
  },
  pair: {
    id: "pair",
    label: "Pair — first launch",
    seed: "unpaired",
    route: { name: "Pair" },
  },
  settings: {
    id: "settings",
    label: "Settings",
    seed: "paired",
    route: { name: "Settings" },
  },
  "orchestra-dash": {
    id: "orchestra-dash",
    label: "Orchestra — Dash product",
    seed: "paired",
    route: { name: "OrchestraDetail", params: { orchestraId: "project:mbp:%2Fhome%2Fyou%2Fworkspace%2Fdash" } },
  },
};

export const DEBUG_SCENARIO_IDS = Object.keys(DEBUG_SCENARIOS) as DebugScenarioId[];

export function resolveScenarioId(raw: string | undefined): DebugScenarioId | null {
  if (!raw) return null;
  const id = raw.trim() as DebugScenarioId;
  return id in DEBUG_SCENARIOS ? id : null;
}
