/**
 * Parse and build pairing magic links. Shared by the bridge (builds) and app (parses).
 *
 * Parse a pairing magic link into the Pair screen's prefill.
 *
 * Accepted shapes (all carry `address` and a six-character `code`):
 * - dev/standalone build: `dash://connect?address=…&code=…`
 * - Expo Go:              `exp://<metro-host>:8097/--/connect?address=…&code=…`
 *                         (also `exps://`, and a bare `…/--/connect?…` path)
 * - bare query:           `connect?address=…&code=…`
 *
 * The parser reads the query by hand instead of using `URL`: React Native's `URL`
 * is a regex shim whose host/path getters only understand http(s), so the
 * scheme-specific route checks below cannot be delegated to it.
 * A link only prefills enrollment. It never carries or grants a credential.
 */
export type PairPrefill = { address: string; code: string };

const CODE = /^[A-Z0-9]{6}$/;
// host or host:port only. Rejects schemes, paths, user info and spaces.
const ADDRESS = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/;

function decode(value: string): string | undefined {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return undefined;
  }
}

function queryParams(query: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const part of query.split("&")) {
    if (!part) continue;
    const cut = part.indexOf("=");
    const key = decode(cut < 0 ? part : part.slice(0, cut));
    const value = decode(cut < 0 ? "" : part.slice(cut + 1));
    // First value wins, so an appended duplicate cannot override the bridge's link.
    if (key === undefined || value === undefined || params.has(key)) continue;
    params.set(key, value);
  }
  return params;
}

/** The app route a link addresses (`connect` for every supported shape). */
function routeOf(beforeQuery: string): string | undefined {
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(beforeQuery);
  const rest = scheme ? beforeQuery.slice(scheme[0].length) : beforeQuery;
  const name = scheme?.[1]?.toLowerCase();
  // Expo Go: everything after `/--/` is the app's own path.
  const expo = rest.indexOf("/--/");
  if (expo >= 0) return rest.slice(expo + 4).replace(/\/+$/, "");
  if (name !== undefined && name !== "dash") return undefined;
  // dash://connect → host "connect"; dash:///connect → path "/connect".
  return rest.replace(/^\/+/, "").replace(/\/+$/, "");
}

export function parseDashConnectUrl(raw: string): PairPrefill | null {
  const text = raw.trim();
  if (!text) return null;
  const hashCut = text.indexOf("#");
  const withoutHash = hashCut >= 0 ? text.slice(0, hashCut) : text;
  const queryCut = withoutHash.indexOf("?");
  if (queryCut < 0) return null;
  if (routeOf(withoutHash.slice(0, queryCut)) !== "connect") return null;
  const params = queryParams(withoutHash.slice(queryCut + 1));
  const address = params.get("address")?.trim();
  const code = params.get("code")?.trim().toUpperCase();
  if (!address || !code || !CODE.test(code) || !ADDRESS.test(address)) return null;
  return { address, code };
}

function connectQuery(prefill: PairPrefill): string {
  return `connect?address=${encodeURIComponent(prefill.address)}&code=${encodeURIComponent(prefill.code)}`;
}

/** Dev/standalone build link. */
export function dashConnectUrl(prefill: PairPrefill): string {
  return `dash://${connectQuery(prefill)}`;
}

/**
 * Expo Go link for the same prefill: `exp://<metro host:port>/--/connect?…`.
 * `metro` is `host:port` or a full `exp://`/`exps://` origin. Anything else is rejected.
 */
export function expoGoConnectUrl(metro: string, prefill: PairPrefill): string | undefined {
  const trimmed = metro.trim().replace(/\/+$/, "");
  const origin = /^exps?:\/\//i.test(trimmed) ? trimmed : `exp://${trimmed}`;
  if (!/^exps?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/i.test(origin)) return undefined;
  return `${origin}/--/${connectQuery(prefill)}`;
}
