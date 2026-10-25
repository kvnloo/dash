import { parseSuggestionInventory, type SuggestionInventory } from "../../../shared/suggestions";
import { composerTrigger } from "./composer-suggestions";

export interface SuggestionTarget {
  harness: string;
  cwd?: string;
}

export interface SuggestionTargetOptions {
  chatHarness?: string;
  selectedHarness?: string;
  connectedHarness?: string;
  chatCwd?: string;
  selectedCwd?: string;
  connectedCwd?: string;
}

/** Chat's real harness/workspace wins; Main uses its configured/default harness. */
export function selectSuggestionTarget(options: SuggestionTargetOptions): SuggestionTarget {
  return {
    harness: options.chatHarness ?? options.selectedHarness ?? options.connectedHarness ?? "hermes",
    cwd: options.chatCwd ?? options.selectedCwd ?? options.connectedCwd,
  };
}

export interface SuggestionSource extends SuggestionTarget {
  address: string;
  token: string;
}

export interface SuggestionLoadState {
  key: string | null;
  inventory: SuggestionInventory;
  loading: boolean;
  error?: string;
}

export const EMPTY_SUGGESTIONS: SuggestionInventory = { commands: [], files: [] };

/** Includes the pairing identity so suggestions from an earlier pairing cannot remain selectable. */
export function suggestionRequestKey(source: SuggestionSource | null): string | null {
  return source ? JSON.stringify([source.address, source.token, source.harness, source.cwd ?? null]) : null;
}

/** React effects run after paint: hide old suggestions synchronously when context changes. */
export function currentSuggestionLoad(key: string | null, state: SuggestionLoadState): SuggestionLoadState {
  return state.key === key
    ? state
    : { key, inventory: EMPTY_SUGGESTIONS, loading: key !== null };
}

export function appendMentionTrigger(text: string): string {
  if (!text.trim()) return "@";
  // Tapping @ while a slash/mention is already in progress must not corrupt it.
  if (composerTrigger(text) !== null || text.startsWith("/")) return text;
  // Preserve the draft; the original prefixing behavior made "@fix this" non-actionable.
  return `${text.trimEnd()} @`;
}

/** The bridge is the only source of real commands and workspace files. */
export async function loadSuggestionInventory(
  source: SuggestionSource,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<SuggestionInventory> {
  const query = `harness=${encodeURIComponent(source.harness)}${source.cwd ? `&cwd=${encodeURIComponent(source.cwd)}` : ""}`;
  const response = await request(`http://${source.address}/suggestions?${query}`, {
    headers: { Authorization: `Bearer ${source.token}` },
    signal,
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("Pairing expired. Re-pair to load suggestions.");
    if (response.status === 404) throw new Error("Update the paired bridge to load suggestions.");
    throw new Error("Could not load suggestions. Check the paired bridge.");
  }
  return parseSuggestionInventory(await response.json());
}
