import type { Conversation, Settings } from "../model";
import { saveSettings, setConnection, store } from "../store/app";

const DEMO_SETTINGS: Settings = {
  address: "100.64.0.1:4747",
  token: "demo-token-not-real",
  harness: "omp",
  inAppFeedback: true,
};

const now = Date.now();

/** Sample chats for UI preview — enable with EXPO_PUBLIC_DEMO=1. */
export const DEMO_CONVERSATIONS: Conversation[] = [
  {
    id: "demo-omp",
    harness: "omp",
    title: "fix the auth bug in login.ts",
    updatedAt: now - 2 * 60_000,
    createdAt: now - 3 * 60_000,
    sessionId: undefined,
    messages: [
      { id: "u1", role: "user", text: "fix the auth bug in login.ts", at: now - 3 * 60_000 },
      {
        id: "a1",
        role: "assistant",
        turnId: "t1",
        state: "done",
        seq: 2,
        text: "I'll read `login.ts` and trace the 401 path.\n\nThe handler was comparing req.headers.authorization to a stale env var.",
        status: "",
        at: now - 2 * 60_000,
      },
    ],
  },
  {
    id: "demo-codex",
    harness: "codex",
    title: "refactor websocket reconnect",
    updatedAt: now - 60 * 60_000,
    createdAt: now - 65 * 60_000,
    sessionId: undefined,
    messages: [
      { id: "u2", role: "user", text: "refactor websocket reconnect logic", at: now - 65 * 60_000 },
      {
        id: "a2",
        role: "assistant",
        turnId: "t2",
        state: "streaming",
        seq: 1,
        text: "Splitting attach/replay into a small state machine…",
        status: "Editing bridge/index.ts",
        at: now - 60 * 60_000,
      },
    ],
  },
];

export function isDemoMode(): boolean {
  return process.env.EXPO_PUBLIC_DEMO === "1";
}

export function applyDemoSeed(): void {
  if (!isDemoMode()) return;
  const { settings, conversations } = store.get();
  if (settings !== null && conversations.length > 0) return;

  saveSettings(DEMO_SETTINGS);
  setConnection({
    status: "online",
    host: "mbp",
    cwd: "~/workspace/dash",
    harnesses: [
      { id: "omp", name: "OMP", available: true },
      { id: "codex", name: "Codex", available: true },
      { id: "grok", name: "Grok", available: true },
      { id: "claude", name: "Claude Code", available: false },
      { id: "hermes", name: "Hermes", available: true },
    ],
  });
  store.set((s) => ({
    ...s,
    conversations: DEMO_CONVERSATIONS,
    activeId: DEMO_CONVERSATIONS[0]?.id ?? null,
  }));
}
