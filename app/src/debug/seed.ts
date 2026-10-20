import AsyncStorage from "@react-native-async-storage/async-storage";
import { applyGateMessage } from "../store/approvals";
import type { Connection, Conversation, Settings } from "../model";
import { DEMO_CONVERSATIONS } from "../mock/seed";
import { saveSettings, setConnection, store } from "../store/app";

const DEBUG_SETTINGS: Settings = {
  address: "100.64.0.1:4747",
  token: "debug-token-not-real",
  harness: "omp",
  cwd: "~/workspace/dash",
  inAppFeedback: true,
};

const DEBUG_HOSTS = [
  {
    id: "mbp",
    name: "mbp",
    hostname: "mbp",
    online: true,
    self: true,
    address: "100.64.0.1",
    agents: [
      { id: "omp:dash", name: "OMP 1", kind: "omp", status: "running" as const, detail: "/home/you/workspace/dash", cwd: "/home/you/workspace/dash" },
      { id: "omp:keyconf", name: "OMP 2", kind: "omp", status: "running" as const, detail: "/home/you/workspace/keyconf.gen", cwd: "/home/you/workspace/keyconf.gen" },
      { id: "harness:codex", name: "Codex", kind: "codex", status: "available" as const, detail: "Installed" },
      { id: "harness:grok", name: "Grok", kind: "grok", status: "available" as const, detail: "Installed" },
      { id: "hermes:clean", name: "clean", kind: "hermes", status: "running" as const, detail: "Hermes profile" },
      // Saved Hermes chats, as the real roster lists them: they belong in Chats, and one is open in a CLI.
      { id: "hermes:session:clean:debug-cli", name: "Make Dash great on the phone: reply into Hermes sessions, magic links and approvals", kind: "hermes", status: "available" as const, sessionId: "debug-cli", profileId: "clean", source: "cli", cwd: "/home/you/workspace/dash", lastActivityAt: Date.now() - 4 * 60_000, messageCount: 42, openIn: "CLI" },
      { id: "hermes:session:clean:debug-saved", name: "Garden room planner review", kind: "hermes", status: "available" as const, sessionId: "debug-saved", profileId: "clean", source: "acp", cwd: "/tmp/hermes-scratch", lastActivityAt: Date.now() - 3 * 3_600_000, messageCount: 6 },
      { id: "harness:claude", name: "Claude Code", kind: "claude", status: "offline" as const, detail: "Not installed" },
      { id: "harness:pi", name: "Pi", kind: "pi", status: "offline" as const, detail: "Not installed" },
      { id: "harness:fx", name: "fx", kind: "fx", status: "offline" as const, detail: "Not installed" },
    ],
    // Fixture bots: deployed messaging identities, not harnesses.
    bots: [
      { id: "hermes-bot:clean", name: "clean", runtime: "hermes", status: "running" as const, channels: [{ platform: "telegram", state: "connected" as const }], agentId: "hermes:clean", detail: "Hermes gateway profile" },
      { id: "hermes-bot:chiefstaff", name: "chiefstaff", runtime: "hermes", status: "available" as const, channels: [{ platform: "discord", state: "configured" as const }, { platform: "telegram", state: "configured" as const }], agentId: "hermes:chiefstaff", detail: "Hermes gateway profile" },
      { id: "service:opendots", name: "opendots", runtime: "service", status: "running" as const, channels: [], detail: "User service" },
    ],
  },
  {
    id: "0",
    name: "0",
    hostname: "groot",
    online: true,
    self: false,
    address: "100.64.0.2",
    agents: [{ id: "hermes", name: "Hermes", kind: "hermes", status: "running" as const, detail: "Mesh node" }],
    bots: [
      { id: "grok-bot", name: "GrokBot", runtime: "grok", status: "running" as const, channels: [{ platform: "discord", state: "connected" as const }], detail: "Desktop app" },
      { id: "hermes-bot:intake", name: "intake", runtime: "hermes", status: "available" as const, channels: [{ platform: "telegram", state: "disconnected" as const }], detail: "Hermes gateway profile" },
    ],
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
    { id: "pi", name: "Pi", available: false },
    { id: "fx", name: "fx", available: false },
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
  // Screenshot-only proposals. They never contact a bridge and cannot authorize posting.
  applyGateMessage({ type: "gate_snapshot", dry_run: true, owner_decisions: false, items: [
    { id: "00000000-0000-4000-8000-000000000001", kind: "pr_comment", state: "pending", target: { repo: "kvnloo/dash", number: 67, title: "Review the pairing fix" }, body: "The pairing error now stays on screen until the next attempt. The regression test covers a refused connection and retry.", evidence: [{ label: "Test evidence", url_or_path: "docs/evidence/pairing.md" }], origin: { agent: "Hermes", session: "debug", created_at: "2026-10-20T12:00:00Z" }, policy: { bulk_ok: true, requires_human_text: false, reason: "Existing review · bounded follow-up", rules: [] }, trail: [] },
    { id: "00000000-0000-4000-8000-000000000003", kind: "pr_review_reply", state: "pending", target: { repo: "kvnloo/dash", number: 68, comment_id: 1 }, body: "Fixed in 6396f76. The test now waits until verification has started before it cancels, and covers both SIGINT and SIGTERM.", evidence: [{ label: "Fix commit", url_or_path: "docs/evidence/fix.md" }], origin: { agent: "Hermes", session: "debug", created_at: "2026-10-20T12:00:00Z" }, policy: { bulk_ok: true, requires_human_text: false, reason: "Contribution rules captured. Review evidence before approval.", rules: [] }, trail: [] },
    { id: "00000000-0000-4000-8000-000000000002", kind: "pr_comment", state: "stale", target: { repo: "kvnloo/dash", number: 66, title: "Refresh changed evidence" }, body: "This proposal needs fresh evidence before approval.", evidence: [{ label: "Changed head", url_or_path: "docs/evidence/head.md" }], origin: { agent: "Codex", session: "debug", created_at: "2026-10-20T12:00:00Z" }, policy: { bulk_ok: false, requires_human_text: false, reason: "Target changed since review", rules: [] }, trail: [] },
  ] });
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

  // Saved phone chats first, so the roster below reconciles them and adopts host chats.
  store.set((s) => ({
    ...s,
    conversations: [...DEMO_CONVERSATIONS, ...([{
      id: "debug-attach", harness: "hermes", title: "What is wrong with these seedlings?", createdAt: Date.now() - 600000, updatedAt: Date.now() - 600000,
      messages: [
        { id: "debug-attach-user", role: "user", text: "What is wrong with these seedlings?", at: Date.now() - 600000, attachments: [{ id: "fedcba9876543210fedcba9876543210", name: "tray-3.jpg", mime: "image/jpeg", size: 1_843_200 }, { id: "00112233445566778899aabbccddeeff", name: "watering-log.txt", mime: "text/plain", size: 2_310 }] },
        { id: "debug-attach-reply", role: "assistant", text: "The lower leaves are yellowing from overwatering: the log shows water every day. I drew the affected plants on a copy at /home/you/Pictures/dash/tray-3-marked.png.", at: Date.now() - 590000, state: "done", turnId: "debug-attach-turn", seq: 0 },
      ],
    }, {
      id: "debug-ended", harness: "hermes", title: "Review the session handoff", createdAt: Date.now() - 86400000, updatedAt: Date.now() - 86400000, stale: true,
      messages: [{ id: "debug-ended-reply", role: "assistant", text: "The handoff is saved. This host session has ended.", at: Date.now() - 86400000, state: "done", turnId: "debug-ended-turn", seq: 0 }],
    }] satisfies (Conversation & { stale?: boolean })[])],
    activeId: DEMO_CONVERSATIONS[0]?.id ?? null,
  }));

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
}
