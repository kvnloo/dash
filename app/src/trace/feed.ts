import { executionToken, type AuthSettings } from "../lib/bridge-auth";
import { parseTraceSnapshot, type TraceSnapshot } from "./model";
export type TraceFetch = (url: string, init?: RequestInit) => Promise<Response>;
export async function fetchTraceSnapshot(settings: AuthSettings & { address: string }, signal?: AbortSignal, fetcher: TraceFetch = fetch): Promise<TraceSnapshot> {
  const response = await fetcher(`http://${settings.address}/trace/snapshot`, { headers: { Authorization: `Bearer ${await executionToken(settings)}` }, signal });
  if (!response.ok) throw new Error(`Trace unavailable (HTTP ${response.status})`);
  const snapshot = parseTraceSnapshot(await response.json());
  if (!snapshot.rows.length) throw new Error("Trace unavailable (no live source data)");
  if (!snapshot.generatedAt || Date.now() - snapshot.generatedAt > 30000 || snapshot.generatedAt > Date.now() + 60000) throw new Error("Trace unavailable (stale source snapshot)");
  return snapshot;
}
