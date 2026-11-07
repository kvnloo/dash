import type { BridgeEndpoint, Settings } from "../model";

/** Per-host health probe budget (spec: 5 s). */
export const PROBE_TIMEOUT_MS = 5000;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

function current(settings: Settings): BridgeEndpoint {
  return { address: settings.address, token: settings.token, ...(settings.identity ? { identity: settings.identity } : {}) };
}

/** Paired bridges in failover order. A legacy single-host settings object is a list of one. */
export function endpointsOf(settings: Settings): BridgeEndpoint[] {
  const list = settings.endpoints?.length ? settings.endpoints : [current(settings)];
  return list.some(e => e.address === settings.address) ? list : [...list, current(settings)];
}

/** Make `endpoint` the bridge in use. The list and its order are kept. */
export function activate(settings: Settings, endpoint: BridgeEndpoint): Settings {
  const list = settings.endpoints?.length ? settings.endpoints : [current(settings)];
  const endpoints = list.some(e => e.address === endpoint.address) ? list : [...list, endpoint];
  const next: Settings = { ...settings, address: endpoint.address, token: endpoint.token, endpoints };
  if (endpoint.identity) next.identity = endpoint.identity;
  else delete next.identity;
  return next;
}

/**
 * Pairing `next` while `previous` is paired: the new bridge joins the list (or replaces the
 * entry with the same address) and becomes the one in use. The primary keeps its place.
 */
export function withPairedEndpoint(previous: Settings | null, next: Settings): Settings {
  const added = current(next);
  const list = previous ? endpointsOf(previous) : [];
  const at = list.findIndex(e => e.address === added.address);
  const endpoints = at >= 0 ? list.map((e, i) => (i === at ? added : e)) : [...list, added];
  return { ...next, endpoints };
}

/** Editing the bridge in use (Settings screen): replace that entry, keep the others. */
export function withEditedEndpoint(previous: Settings | null, next: Settings): Settings {
  if (!previous) return { ...next, endpoints: [current(next)] };
  const list = endpointsOf(previous);
  const at = list.findIndex(e => e.address === previous.address);
  const edited = current(next);
  const replaced = at >= 0 ? list.map((e, i) => (i === at ? edited : e)) : [...list, edited];
  const endpoints = replaced.filter((e, i) => replaced.findIndex(o => o.address === e.address) === i);
  return { ...next, endpoints };
}

/** Drop one bridge from the list (never the last one). */
export function withoutEndpoint(settings: Settings, address: string): Settings {
  const list = endpointsOf(settings).filter(e => e.address !== address);
  if (list.length === 0) return settings;
  const next = { ...settings, endpoints: list };
  const first = list[0];
  return settings.address === address && first ? activate(next, first) : next;
}

/**
 * Is a bridge process answering at `address`? Any HTTP reply counts (an unauthenticated
 * GET /ws answers 401). Network errors and the timeout count as down.
 */
export async function probeBridge(address: string, fetchImpl: Fetch = fetch, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<false>(resolve => { timer = setTimeout(() => { abort.abort(); resolve(false); }, timeoutMs); });
  const probe = fetchImpl(`http://${address}/ws`, { method: "GET", signal: abort.signal })
    .then(response => response.status > 0 && response.status < 500)
    .catch(() => false);
  try {
    return await Promise.race([probe, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * First answering bridge in list order, or undefined when none answers.
 * `skip` is the bridge whose socket just failed: its HTTP probe can answer while the
 * socket cannot open (stale token, identity down), so it must not win the pick again.
 */
export async function pickEndpoint(settings: Settings, probe: (address: string) => Promise<boolean>, skip?: string): Promise<BridgeEndpoint | undefined> {
  for (const endpoint of endpointsOf(settings)) {
    if (endpoint.address === skip) continue;
    if (await probe(endpoint.address)) return endpoint;
  }
  return undefined;
}
