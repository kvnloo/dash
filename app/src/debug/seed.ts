import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Connection, Settings } from "../model";
import { DEMO_CONVERSATIONS } from "../mock/seed";
import { saveSettings, setConnection, store } from "../store/app";

const DEBUG_SETTINGS: Settings = {
  address: "100.78.215.21:4747",
  token: "debug-token-not-real",
  harness: "omp",
  cwd: "~/workspace/dash",
};

const DEBUG_HOSTS = [
  {
    id: "mbp",
    name: "mbp",
    hostname: "mbp",
    online: true,
    self: true,
    address: "100.78.215.21",
    agents: [
      { id: "omp:dash", name: "OMP 1", kind: "omp", status: "running" as const, detail: "/home/kvn/workspace/dash", cwd: "/home/kvn/workspace/dash" },
      { id: "omp:keyconf", name: "OMP 2", kind: "omp", status: "running" as const, detail: "/home/kvn/workspace/keyconf.gen", cwd: "/home/kvn/workspace/keyconf.gen" },
      { id: "harness:codex", name: "Codex", kind: "codex", status: "available" as const, detail: "Installed" },
      { id: "harness:grok", name: "Grok", kind: "grok", status: "available" as const, detail: "Installed" },
      { id: "harness:hermes", name: "Hermes", kind: "hermes", status: "available" as const, detail: "Installed" },
      { id: "harness:claude", name: "Claude Code", kind: "claude", status: "offline" as const, detail: "Not installed" },
    ],
  },
  {
    id: "0",
    name: "0",
    hostname: "groot",
    online: true,
    self: false,
    address: "100.113.138.100",
    agents: [{ id: "hermes", name: "Hermes", kind: "hermes", status: "running" as const, detail: "Mesh node" }],
  },
];

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
  hosts: DEBUG_HOSTS,
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
      connection: { status: "idle", harnesses: [], hosts: [] },
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
      hosts: DEBUG_HOSTS,
    });
  } else if (variant === "connecting") {
    setConnection({
      status: "connecting",
      host: undefined,
      cwd: undefined,
      error: undefined,
      harnesses: ONLINE_CONNECTION.harnesses ?? [],
      hosts: DEBUG_HOSTS,
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
