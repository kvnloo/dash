// Agent -> app UI control on the phone (docs/specs/ui-control.md). The bridge delivers a parsed
// ui_control frame; this module checks the owner's consent, performs it directly through the
// navigation container and stores (never synthetic taps), records a visible receipt, and answers
// with an ack so the agent learns what happened.
import { CommonActions } from "@react-navigation/native";
import type { ChatSummary } from "../../../shared/protocol";
import type { UiControlAckStatus, UiControlClientMessage, UiControlCommand, UiControlFrame } from "../../../shared/ui-control";
import { debugNavigationRef } from "../debug/nav";
import { createOverlayState, reduceOverlay, type OverlayEvent, type OverlayState } from "../lib/ui-control-overlay";
import type { Conversation } from "../model";
import type { RootStackParamList } from "../navigation";
import { enterAnnotation } from "./annotate";
import { openChat, saveSettings, setActive, store } from "./app";
import { chatIndexStore } from "./chat-index-store";
import { createStore } from "./createStore";

type Ack = Extract<UiControlClientMessage, { type: "ui_control_ack" }>;

/** The visible "an agent did this" receipt; every accepted or refused command shows one. */
export interface AgentActivity {
  seq: number;
  text: string;
  status: UiControlAckStatus;
  at: number;
}

export interface AgentControlState {
  overlay: OverlayState;
  activity?: AgentActivity;
}

/** Navigate/clear receipts expire well inside the spec's 30 s ceiling. */
export const ACTIVITY_MS = 8000;
/** How long a navigation may take to commit before the agent hears "skipped". */
const SETTLE_MS = 1500;

export const agentControl = createStore<AgentControlState>({ overlay: createOverlayState() });
let activitySeq = 0;

export function agentControlEnabled(): boolean {
  return store.get().settings?.agentControl === true;
}

function dispatch(event: OverlayEvent): OverlayState {
  agentControl.set(s => ({ ...s, overlay: reduceOverlay(s.overlay, event) }));
  return agentControl.get().overlay;
}

function record(text: string, status: UiControlAckStatus): void {
  activitySeq += 1;
  agentControl.set(s => ({ ...s, activity: { seq: activitySeq, text: text.slice(0, 120), status, at: Date.now() } }));
}

export function dismissActivity(): void {
  agentControl.set(s => (s.activity ? { ...s, activity: undefined } : s));
}

/** Owner's "Stop" on the receipt and the Settings switch: off drops overlays and pending work. */
export function setAgentControl(on: boolean): void {
  const settings = store.get().settings;
  if (!settings || (settings.agentControl === true) === on) return;
  const { agentControl: _previous, ...rest } = settings;
  saveSettings(on ? { ...rest, agentControl: true } : rest);
  dispatch({ type: on ? "enable" : "disable" });
  if (!on) dismissActivity();
}

function currentScreen(): string | undefined {
  const route = debugNavigationRef.isReady() ? debugNavigationRef.getCurrentRoute() : undefined;
  return route?.name;
}

const norm = (title: string) => title.trim().replace(/\s+/g, " ").toLowerCase();

type ChatTarget = { kind: "local"; conversation: Conversation } | { kind: "summary"; summary: ChatSummary };

/** Phone chats first (newest wins), then rows the chat index has listed on this phone. */
function findChat(command: Extract<UiControlCommand, { type: "navigate" }>): ChatTarget | undefined {
  const { conversations, settings } = store.get();
  const own = conversations.filter(c => !c.endpointAddress || c.endpointAddress === settings?.address);
  if (command.conversationId !== undefined) {
    const conversation = own.find(c => c.id === command.conversationId);
    return conversation ? { kind: "local", conversation } : undefined;
  }
  if (command.chatTitle === undefined) return undefined;
  const wanted = norm(command.chatTitle);
  const local = own.filter(c => norm(c.title) === wanted).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (local) return { kind: "local", conversation: local };
  for (const list of Object.values(chatIndexStore.get().lists)) {
    const summary = [...list.list.head, ...list.list.rows].find((row): row is ChatSummary => row !== null && norm(row.title) === wanted);
    if (summary) return { kind: "summary", summary };
  }
  return undefined;
}

/** pop: return to that screen if it is already in the stack (v7 navigate would push a second copy). */
function navigateTo<T extends keyof RootStackParamList>(name: T, params?: RootStackParamList[T]): void {
  debugNavigationRef.dispatch(CommonActions.navigate({ name, params, pop: true }));
}

/** Resolves when the container shows `name`, or false after SETTLE_MS. */
function settled(name: keyof RootStackParamList): Promise<boolean> {
  const started = Date.now();
  return new Promise(resolve => {
    const check = () => {
      if (currentScreen() === name) { resolve(true); return; }
      if (Date.now() - started > SETTLE_MS) { resolve(false); return; }
      setTimeout(check, 16);
    };
    check();
  });
}

async function navigate(command: Extract<UiControlCommand, { type: "navigate" }>): Promise<{ status: UiControlAckStatus; detail: string }> {
  if (!debugNavigationRef.isReady()) return { status: "skipped", detail: "The app is still starting." };
  const opened = async (name: keyof RootStackParamList, label: string) =>
    await settled(name) ? { status: "done" as const, detail: `Opened ${label}` } : { status: "skipped" as const, detail: `${label} did not open` };
  // Same mapping as the dash:// app-route links in App.tsx.
  switch (command.route) {
    case "Hosts":
    case "Bots": navigateTo("Main", { tab: 0 }); return opened("Main", "Hosts");
    case "Chats": navigateTo("Main", { tab: 1 }); return opened("Main", "Chats");
    case "Orchestra": navigateTo("Main", { tab: 2 }); return opened("Main", "Orchestra");
    case "Settings":
    case "Trace":
    case "Lab": navigateTo(command.route); return opened(command.route, command.route);
    case "Chat": break;
  }
  let title = "Chat";
  if (command.conversationId !== undefined || command.chatTitle !== undefined) {
    const target = findChat(command);
    if (!target) return { status: "skipped", detail: `No chat ${command.chatTitle !== undefined ? `titled "${command.chatTitle}"` : `with id ${command.conversationId}`} on this phone` };
    if (target.kind === "local") { setActive(target.conversation.id); title = target.conversation.title; }
    else { title = openChat(target.summary).title; }
  }
  // The same presentation as tapping a row on Chats: a window over the retained list.
  navigateTo("Chat", { window: { y: 0, height: 0 } });
  if (!(await settled("Chat"))) return { status: "skipped", detail: `${title} did not open` };
  if (command.annotate) enterAnnotation();
  return { status: "done", detail: `Opened ${title}${command.annotate ? " › Annotate" : ""}` };
}

function describe(command: UiControlCommand): string {
  switch (command.type) {
    case "point": return "Pointer";
    case "draw": return "Drawing";
    case "highlight": return "Highlight";
    case "clear": return "Cleared agent marks";
    case "navigate": return `Open ${command.route}`;
  }
}

/** Overlay commands render in a later layer; this build acknowledges them honestly. */
async function perform(command: UiControlCommand): Promise<{ status: UiControlAckStatus; detail: string }> {
  switch (command.type) {
    case "navigate":
      try { return await navigate(command); }
      finally { dispatch({ type: "navigated", id: command.id, at: Date.now() }); }
    case "clear": return { status: "done", detail: describe(command) };
    case "point":
    case "draw":
    case "highlight": return { status: "skipped", detail: "This Dash build cannot draw agent overlays yet" };
  }
}

export async function handleUiControlFrame(frame: UiControlFrame, reply: (ack: Ack) => void): Promise<void> {
  const received = Date.now();
  const command = frame.command;
  const answer = (status: UiControlAckStatus, detail: string) => {
    record(`Agent · ${detail}`, status);
    const screen = currentScreen();
    reply({ type: "ui_control_ack", ref: frame.ref, status, detail: detail.slice(0, 200), ms: Date.now() - received, ...(screen ? { screen } : {}) });
  };
  if (!agentControlEnabled()) {
    // Consent lives on the phone; the bridge only learns it from ui_control_hello.
    if (agentControl.get().overlay.enabled) dispatch({ type: "disable" });
    answer("refused", "Agent control is off (Settings > Agent control)");
    return;
  }
  if (!agentControl.get().overlay.enabled) dispatch({ type: "enable" });
  const entry = dispatch({ type: "command", command, at: received }).log.at(-1);
  if (entry?.kind === "dropped" && entry.at === received) { answer("refused", `${describe(command)} blocked: dismissed moments ago, or a duplicate command id`); return; }
  try {
    const result = await perform(command);
    answer(result.status, result.detail);
  } catch {
    answer("skipped", `${describe(command)} failed on the phone`);
  }
}

/** Capability + consent for the bridge; re-sent whenever the owner flips the switch. */
export function uiControlHello(): Extract<UiControlClientMessage, { type: "ui_control_hello" }> {
  return { type: "ui_control_hello", enabled: agentControlEnabled() };
}

export function onAgentControlChange(listener: (enabled: boolean) => void): () => void {
  let last = agentControlEnabled();
  return store.subscribe(() => {
    const next = agentControlEnabled();
    if (next === last) return;
    last = next;
    listener(next);
  });
}
