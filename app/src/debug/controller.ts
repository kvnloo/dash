import { replyText } from "../store/text";
import type { ThinkingPhase } from "../lib/thinking";
import type { RootStackParamList } from "../navigation";
import { setActive, store } from "../store/app";
import { debugNavigate, debugResetTo, flushPendingDebugNavigation, waitForDebugNavigation } from "./nav";
import { applyDebugSeed, type DebugSeedVariant } from "./seed";
import {
  DEBUG_SCENARIO_IDS,
  DEBUG_SCENARIOS,
  resolveScenarioId,
  type DebugScenarioId,
} from "./scenarios";
import { debugUi } from "./ui-store";
import { replyText } from "../store/text";

export type DebugCommand =
  | { action: "scenario"; id: DebugScenarioId }
  | { action: "navigate"; screen: keyof RootStackParamList; params?: RootStackParamList[keyof RootStackParamList] }
  | { action: "reset"; seed?: DebugSeedVariant }
  | { action: "setSearch"; query: string }
  | { action: "setMainTab"; index: number }
  | { action: "setHarnessPicker"; open: boolean }
  | { action: "setActiveChat"; conversationId: string | null }
  | { action: "setThinking"; phase: ThinkingPhase }
  | { action: "setConnection"; status: "online" | "offline" | "connecting" | "idle" }
  | { action: "setBridgePull"; open: boolean }
  | { action: "wait"; ms: number }
  | { action: "uxOutput"; text: string }
  | { action: "listScenarios" };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyScenarioUi(spec: (typeof DEBUG_SCENARIOS)[DebugScenarioId]): void {
  debugUi.set((s) => ({
    ...s,
    mainSearchQuery: spec.ui?.mainSearchQuery ?? null,
    mainTabIndex: spec.ui?.mainTabIndex ?? null,
    chatHarnessPickerOpen: spec.ui?.chatHarnessPickerOpen ?? null,
    chatComposerAttachments: spec.ui?.chatComposerAttachments ?? null,
  }));
  if (spec.ui?.activeConversationId) {
    setActive(spec.ui.activeConversationId);
  }
}

export async function runScenario(id: DebugScenarioId): Promise<void> {
  const spec = DEBUG_SCENARIOS[id];
  applyDebugSeed(spec.seed);
  applyScenarioUi(spec);
  await waitForDebugNavigation();
  debugResetTo(spec.route.name, spec.route.params);
  flushPendingDebugNavigation();
  await sleep(200);
  debugUi.set((s) => ({ ...s, ready: true }));
}

export async function runDebugCommand(cmd: DebugCommand): Promise<unknown> {
  switch (cmd.action) {
    case "uxOutput": {
      // Local fixture only; exercise per-reply rAF subscriptions without a host.
      store.set(s => ({ ...s, conversations: s.conversations.map(c => c.id !== "ux-long" ? c : {
        ...c, messages: c.messages.map(m => m.id === "ux-a-24" && m.role === "assistant" ? { ...m, state: "streaming" } : m),
      }) }));
      const chat = store.get().conversations.find(c => c.id === "ux-long");
      const message = chat?.messages.find(m => m.id === "ux-a-24");
      const current = replyText.get("ux-t-24") || message?.text || "";
      replyText.set("ux-t-24", current + cmd.text);
      return { ok: true };
    }
    case "listScenarios":
      return DEBUG_SCENARIO_IDS.map((id) => ({ id, label: DEBUG_SCENARIOS[id].label }));
    case "scenario":
      await runScenario(cmd.id);
      return { ok: true, id: cmd.id };
    case "navigate":
      await waitForDebugNavigation();
      debugNavigate(cmd.screen, cmd.params);
      flushPendingDebugNavigation();
      return { ok: true };
    case "reset":
      applyDebugSeed(cmd.seed ?? "paired");
      return { ok: true };
    case "setSearch":
      debugUi.set((s) => ({ ...s, mainSearchQuery: cmd.query }));
      return { ok: true };
    case "setMainTab":
      debugUi.set((s) => ({ ...s, mainTabIndex: cmd.index }));
      return { ok: true };
    case "setHarnessPicker":
      debugUi.set((s) => ({ ...s, chatHarnessPickerOpen: cmd.open }));
      return { ok: true };
    case "setActiveChat":
      setActive(cmd.conversationId);
      return { ok: true };
    case "setThinking": {
      const current = store.get();
      const conversation = current.conversations.find(c => c.id === current.activeId);
      const latest = conversation ? [...conversation.messages].reverse().find(m => m.role === "assistant") : undefined;
      if (!latest || latest.role !== "assistant") return { ok: false };
      replyText.clear(latest.turnId);
      store.set(s => ({ ...s, conversations: s.conversations.map(c => c.id !== conversation?.id ? c : { ...c, messages: c.messages.map(m => m.id !== latest.id || m.role !== "assistant" ? m : { ...m, state: cmd.phase === "idle" ? "done" : "streaming", text: cmd.phase === "streaming" ? "Streaming response…" : "", status: cmd.phase === "tool" ? "Running terminal" : cmd.phase === "waiting-approval" ? "Waiting for approval" : cmd.phase === "thinking" ? "Thinking" : undefined }) }) }));
      return { ok: true };
    }
    case "setConnection":
      store.set((s) => ({ ...s, connection: { ...s.connection, status: cmd.status } }));
      return { ok: true };
    case "setBridgePull": {
      const { debugSetBridgePull } = await import("../components/BridgePull");
      debugSetBridgePull(cmd.open);
      return { ok: true };
    }
    case "wait":
      await sleep(cmd.ms);
      return { ok: true };
    default:
      return { ok: false, error: "unknown command" };
  }
}

export async function bootstrapDebugScenario(scenarioRaw: string | undefined): Promise<void> {
  const id = resolveScenarioId(scenarioRaw);
  if (!id) {
    applyDebugSeed("paired");
    debugUi.set((s) => ({ ...s, ready: true }));
    return;
  }
  await runScenario(id);
  debugUi.set((s) => ({ ...s, ready: true }));
}
