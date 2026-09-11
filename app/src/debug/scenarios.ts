import type { RootStackParamList } from "../navigation";
import type { DebugSeedVariant } from "./seed";

export type DebugScenarioId =
  | "main"
  | "main-bots"
  | "main-chats"
  | "main-products"
  | "main-files"
  | "chat-omp"
  | "chat-streaming"
  | "chat-picker"
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
    mainTabIndex?: number;
    chatHarnessPickerOpen?: boolean;
    activeConversationId?: string;
  };
}

export const DEBUG_SCENARIOS: Record<DebugScenarioId, DebugScenario> = {
  main: {
    id: "main",
    label: "Main — Chats tab",
    seed: "paired",
    route: { name: "Main" },
    ui: { mainSearchQuery: "", mainTabIndex: 1 },
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
    route: { name: "OrchestraDetail", params: { orchestraId: "dash" } },
  },
};

export const DEBUG_SCENARIO_IDS = Object.keys(DEBUG_SCENARIOS) as DebugScenarioId[];

export function resolveScenarioId(raw: string | undefined): DebugScenarioId | null {
  if (!raw) return null;
  const id = raw.trim() as DebugScenarioId;
  return id in DEBUG_SCENARIOS ? id : null;
}
