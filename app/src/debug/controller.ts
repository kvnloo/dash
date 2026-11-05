import type { ReplyPart } from "../../../shared/protocol";
import { applyDeltas, applyTurnEvent } from "../store/app";
import { replyParts, replyText } from "../store/text";
import { parseSummary, type SummaryInfo } from "../../../shared/thinking-summary";
import type { ThinkingPhase } from "../lib/thinking";
import type { RootStackParamList } from "../navigation";
import { saveSettings, setActive, store } from "../store/app";
import type { Z0LiveState } from "../../../shared/z0live-state";
import type { CutoutReading, HostSessionReading } from "../lib/chat-window";
import type { VoiceState } from "../lib/continuous-voice";
import { debugNavigate, debugResetTo, flushPendingDebugNavigation, waitForDebugNavigation } from "./nav";
import { applyDebugSeed, type DebugSeedVariant } from "./seed";
import {
  DEBUG_SCENARIO_IDS,
  DEBUG_SCENARIOS,
  resolveScenarioId,
  type DebugScenarioId,
} from "./scenarios";
import { debugUi } from "./ui-store";

export type DebugCommand =
  | { action: "scenario"; id: DebugScenarioId }
  | { action: "navigate"; screen: keyof RootStackParamList; params?: RootStackParamList[keyof RootStackParamList] }
  | { action: "reset"; seed?: DebugSeedVariant }
  | { action: "setSearch"; query: string }
  | { action: "setMainTab"; index: number }
  | { action: "setHarnessPicker"; open: boolean }
  | { action: "setActiveChat"; conversationId: string | null }
  | { action: "setThinking"; phase: ThinkingPhase }
  | { action: "setHandedness"; side: "left" | "right" }
  | { action: "setVoiceFixture"; state: Z0LiveState | null }
  | { action: "setVoiceStateFixture"; state: VoiceState | null }
  | { action: "setCutoutFixture"; reading: CutoutReading | null }
  | { action: "setHostSessionFixture"; reading: HostSessionReading | null }
  | { action: "setConnection"; status: "online" | "offline" | "connecting" | "idle" }
  | { action: "setBridgePull"; open: boolean }
  | { action: "wait"; ms: number }
  | { action: "replyFixture"; reset?: boolean; part?: ReplyPart; text?: string; seq: number }
  | { action: "thinkingSummary"; summary: SummaryInfo }
  | { action: "uxOutput"; text: string }
  | { action: "genuiReply"; text: string }
  | { action: "contextTarget"; address: string; token: string; session: string; profile?: string; harness?: "omp" | "hermes" }
  | { action: "listScenarios" };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyScenarioUi(spec: (typeof DEBUG_SCENARIOS)[DebugScenarioId]): void {
  debugUi.set((s) => ({
    ...s,
    mainSearchQuery: spec.ui?.mainSearchQuery ?? null,
    orchestraFixture: spec.ui?.orchestraFixture ?? false,
    mainTabIndex: spec.ui?.mainTabIndex ?? null,
    chatHarnessPickerOpen: spec.ui?.chatHarnessPickerOpen ?? null,
    chatComposerAttachments: spec.ui?.chatComposerAttachments ?? null,
    z0liveFixture: spec.ui?.z0liveFixture ?? null,
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
    case "contextTarget": {
      // Debug-only loopback proof target. Never import a user's live transcript into a fixture.
      if (!/^(localhost|127\.0\.0\.1):\d+$/.test(cmd.address)) return { ok: false };
      store.set(s => ({ ...s, settings: s.settings ? { ...s.settings, address: cmd.address, token: cmd.token } : null,
        connection: { ...s.connection, status: "online" }, activeId: "context-proof", conversations: [{ id: "context-proof", title: "Context window · read-only proof", harness: cmd.harness ?? "hermes", sessionId: cmd.session, profileId: cmd.profile ?? "default", createdAt: 1, updatedAt: 1, messages: [
          { id: "proof-prompt", role: "user", text: "Inspect the context budget (read-only render proof).", at: 1 },
          { id: "proof-answer", role: "assistant", text: "This is a local test transcript around real host context counts. No production session is modified.", at: 2, state: "done", turnId: "proof-turn", seq: 1 },
        ] }] }));
      debugResetTo("Chat", {}); flushPendingDebugNavigation();
      return { ok: true };
    }
    case "genuiReply": {
      // Offline deterministic renderer fixture; never starts an agent or changes a paired host.
      store.set(s => ({ ...s, conversations: s.conversations.map(c => c.id !== s.activeId ? c : { ...c, messages: [
        { id: "genui-user", role: "user", text: "Show an inline UI · test fixture", at: 1 },
        { id: "genui-reply", role: "assistant", text: cmd.text.slice(0, 200000), at: 2, state: "done", turnId: "genui-turn", seq: 1 },
      ] }) }));
      return { ok: true };
    }
    case "replyFixture": {
      if (cmd.reset) {
        replyText.clear("detail-fixture-turn"); replyParts.clear("detail-fixture-turn");
        store.set(s => ({ ...s, activeId: "detail-fixture", conversations: [{ id: "detail-fixture", harness: "hermes", title: "Wrapped thinking & tools", createdAt: 1, updatedAt: 1, messages: [{ id: "detail-fixture-user", role: "user", text: "Check the streaming pipeline", at: 1 }, { id: "detail-fixture-answer", role: "assistant", text: "", at: 2, turnId: "detail-fixture-turn", state: "streaming", seq: 0 }] }] }));
        debugResetTo("Chat", {}); flushPendingDebugNavigation();
      }
      if (cmd.part) applyTurnEvent({ type: "status", id: "detail-fixture-turn", seq: cmd.seq, text: "", part: cmd.part });
      if (cmd.text) applyDeltas(new Map([["detail-fixture-turn", { seq: cmd.seq, text: cmd.text }]]));
      return { ok: true };
    }
    case "thinkingSummary": {
      const summary = parseSummary(cmd.summary);
      if (!summary) return { ok: false };
      const active = store.get().activeId;
      store.set(s => ({ ...s, conversations: s.conversations.map(c => c.id !== active ? c : { ...c, messages: c.messages.map((m, i) => m.role === "assistant" && i === c.messages.length - 1 ? { ...m, summaries: [...(m.summaries ?? []).filter(item => item.blockId !== summary.blockId), summary] } : m) }) }));
      return { ok: true, fixture: true };
    }
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
    case "setHandedness": {
      const settings = store.get().settings;
      if (!settings) return { ok: false };
      saveSettings({ ...settings, handedness: cmd.side });
      return { ok: true };
    }
    case "setVoiceFixture":
      debugUi.set(s => ({ ...s, z0liveFixture: cmd.state }));
      return { ok: true };
    case "setVoiceStateFixture":
      debugUi.set(s => ({ ...s, voiceStateFixture: cmd.state }));
      return { ok: true };
    case "setCutoutFixture":
      debugUi.set(s => ({ ...s, cutoutFixture: cmd.reading }));
      return { ok: true };
    case "setHostSessionFixture":
      debugUi.set(s => ({ ...s, hostSessionFixture: cmd.reading }));
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
      const { debugSetBridgePull }: typeof import("../components/BridgePull") = require("../components/BridgePull");
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
