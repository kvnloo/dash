import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { createStore, type Store } from "./createStore";
import { nextActionConversationKey } from "../lib/next-action";


interface TimedAction { readonly until: number }
export interface NextActionPreferences {
  readonly dismissed: Readonly<Record<string, TimedAction>>;
  readonly snoozed: Readonly<Record<string, TimedAction>>;
  readonly lastSeen: Readonly<Record<string, string>>;
  readonly initializedScopes: Readonly<Record<string, true>>;
  readonly restored: boolean;
}
interface Runtime {
  readonly store: Store<NextActionPreferences>;
  readonly restored: Promise<void>;
  flush(): Promise<void>;
}

declare global {
  var __dashNextActionPreferencesRuntime: Runtime | undefined;
}

const KEY = "dash.nextActionPreferences.v1";
const RETAIN_MS = 30 * 24 * 60 * 60_000;
const EMPTY: NextActionPreferences = { dismissed: {}, snoozed: {}, lastSeen: {}, initializedScopes: {}, restored: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseTimed(value: unknown, cutoff: number): Record<string, TimedAction> {
  if (!isRecord(value)) return {};
  const result: Record<string, TimedAction> = {};
  for (const [id, item] of Object.entries(value)) {
    if (!isRecord(item)) continue;
    const until = item.until;
    if (typeof until === "number" && Number.isFinite(until) && until > cutoff) result[id] = { until };
  }
  return result;
}

function parseSeen(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [id, observation] of Object.entries(value)) {
    if (typeof observation === "string") result[id] = observation;
  }
  return result;
}
function parseInitializedScopes(value: unknown): Record<string, true> {
  if (!isRecord(value)) return {};
  const result: Record<string, true> = {};
  for (const [scope, initialized] of Object.entries(value)) {
    if (scope && initialized === true) result[scope] = true;
  }
  return result;
}


function parse(raw: string): NextActionPreferences {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) return EMPTY;
  const now = Date.now();
  return {
    dismissed: parseTimed(value.dismissed, now - RETAIN_MS),
    snoozed: parseTimed(value.snoozed, now),
    lastSeen: parseSeen(value.lastSeen),
    initializedScopes: parseInitializedScopes(value.initializedScopes),
    restored: true,
  };
}

function createRuntime(): Runtime {
  const state = createStore<NextActionPreferences>(EMPTY);
  let inFlight: Promise<void> = Promise.resolve();
  let changedBeforeRestore = false;

  const persist = (): Promise<void> => {
    const current = state.get();
    const value = JSON.stringify({ dismissed: current.dismissed, snoozed: current.snoozed, lastSeen: current.lastSeen, initializedScopes: current.initializedScopes });
    const task = inFlight.catch(() => undefined).then(() => AsyncStorage.setItem(KEY, value));
    inFlight = task;
    return task;
  };
  const flush = async (): Promise<void> => {
    await restored;
    await inFlight;
  };

  state.subscribe(() => {
    if (!state.get().restored) { changedBeforeRestore = true; return; }
    void persist();
  });
  AppState.addEventListener("change", next => { if (next !== "active") void flush(); });

  const restored = AsyncStorage.getItem(KEY).then(raw => {
    const saved = raw ? parse(raw) : { ...EMPTY, restored: true };
    state.set(current => {
      if (!changedBeforeRestore) return saved;
      const lastSeen = { ...saved.lastSeen, ...current.lastSeen };
      return {
        dismissed: { ...saved.dismissed, ...current.dismissed },
        snoozed: { ...saved.snoozed, ...current.snoozed },
        lastSeen,
        initializedScopes: { ...saved.initializedScopes, ...current.initializedScopes },
        restored: true,
      };
    });
  }).catch(() => state.set(current => ({ ...current, restored: true })));

  return { store: state, restored, flush };
}

function runtime(): Runtime {
  return globalThis.__dashNextActionPreferencesRuntime ??= createRuntime();
}

export const nextActionPreferences = runtime().store;
export const nextActionPreferencesRestored = runtime().restored;

export function snoozeNextAction(id: string, until: number): void {
  nextActionPreferences.set(current => ({ ...current, snoozed: { ...current.snoozed, [id]: { until } } }));
}

export function dismissNextAction(id: string, now: number): void {
  nextActionPreferences.set(current => ({ ...current, dismissed: { ...current.dismissed, [id]: { until: now } } }));
}



export function isReplySeenInitialized(preferences: NextActionPreferences, scope: string | undefined): boolean {
  return scope !== undefined && preferences.initializedScopes[scope] === true;
}

export function markConversationReplySeen(scope: string, conversationId: string, observation: string): void {
  const key = nextActionConversationKey(scope, conversationId);
  nextActionPreferences.set(current => {
    if (current.lastSeen[key] === observation) return current;
    return { ...current, lastSeen: { ...current.lastSeen, [key]: observation } };
  });
}

export function initializeReplySeen(scope: string, seen: Readonly<Record<string, string>>): void {
  nextActionPreferences.set(current => {
    if (current.initializedScopes[scope]) return current;
    const scopedSeen: Record<string, string> = {};
    for (const [conversationId, observation] of Object.entries(seen)) {
      scopedSeen[nextActionConversationKey(scope, conversationId)] = observation;
    }
    return {
      ...current,
      lastSeen: { ...scopedSeen, ...current.lastSeen },
      initializedScopes: { ...current.initializedScopes, [scope]: true },
    };
  });
}

export async function clearNextActionPreferences(): Promise<void> {
  await runtime().restored;
  nextActionPreferences.set({ ...EMPTY, restored: true });
  await runtime().flush();
}
