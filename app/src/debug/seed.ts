import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Connection, Settings } from "../model";
import { DEMO_CONVERSATIONS } from "../mock/seed";
import { saveSettings, setConnection, store } from "../store/app";

const DEBUG_SETTINGS: Settings = {
  address: "100.64.0.1:4747",
  token: "debug-token-not-real",
  harness: "omp",
  cwd: "~/workspace/dash",
};

const ONLINE_CONNECTION: Partial<Connection> = {
  status: "online",
  host: "mbp",
  cwd: "~/workspace/dash",
  error: undefined,
  harnesses: [
    { id: "omp", name: "OMP", available: true },
    { id: "codex", name: "Codex", available: true },
    { id: "grok", name: "Grok", available: true },
    { id: "claude", name: "Claude Code", available: false },
    { id: "hermes", name: "Hermes", available: true },
  ],
};

export type DebugSeedVariant = "paired" | "unpaired" | "offline" | "connecting";

const STORAGE_KEYS = ["dash.settings.v1", "dash.conversations.v1", "dash.activeId.v1"] as const;

/** Wipe persisted state so screenshots are reproducible. */
export async function clearDebugPersistence(): Promise<void> {
  await AsyncStorage.multiRemove([...STORAGE_KEYS]);
}

export function applyDebugSeed(variant: DebugSeedVariant = "paired"): void {
  if (variant === "unpaired") {
    store.set((s) => ({
      ...s,
      settings: null,
      connection: { status: "idle", harnesses: [] },
      conversations: [],
      activeId: null,
    }));
    return;
  }

  saveSettings(DEBUG_SETTINGS);

  if (variant === "offline") {
    setConnection({
      status: "offline",
      host: "mbp",
      cwd: "~/workspace/dash",
      error: "Debug: bridge unreachable",
      harnesses: ONLINE_CONNECTION.harnesses ?? [],
    });
  } else if (variant === "connecting") {
    setConnection({
      status: "connecting",
      host: undefined,
      cwd: undefined,
      error: undefined,
      harnesses: ONLINE_CONNECTION.harnesses ?? [],
    });
  } else {
    setConnection(ONLINE_CONNECTION);
  }

  store.set((s) => ({
    ...s,
    conversations: DEMO_CONVERSATIONS,
    activeId: DEMO_CONVERSATIONS[0]?.id ?? null,
  }));
}
