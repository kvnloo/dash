import { parseTraceSnapshot, type TraceSnapshot } from "./model";
export type TraceFetch = (url: string, init?: RequestInit) => Promise<Response>;
export async function fetchTraceSnapshot(settings: { address: string; token: string }, signal?: AbortSignal, fetcher: TraceFetch = fetch): Promise<TraceSnapshot> {
  const response = await fetcher(`http://${settings.address}/trace/snapshot`, { headers: { Authorization: `Bearer ${settings.token.trim()}` }, signal });
  if (!response.ok) throw new Error(`Trace unavailable (HTTP ${response.status})`);
  return parseTraceSnapshot(await response.json());
}
