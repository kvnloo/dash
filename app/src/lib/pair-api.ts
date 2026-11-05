import type { HarnessInfo } from "../../../shared/protocol";
import type { Settings } from "../model";
import { bytesToBase64, claimKeyToBase64Url } from "./pair-crypto";

export interface PairClaimResult {
  address: string;
  token: string;
  host: string;
  cwd: string;
  harnesses: HarnessInfo[];
}

function parseHarnesses(value: unknown): HarnessInfo[] {
  if (!Array.isArray(value)) return [];
  const result: HarnessInfo[] = [];
  for (const entry of value) {
    if (record(entry) && typeof entry.id === "string" && typeof entry.name === "string" && typeof entry.available === "boolean") {
      result.push({ id: entry.id, name: entry.name, available: entry.available });
    }
  }
  return result;
}

const FETCH_MS = 8000;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function baseUrl(computer: string, port = 4747): string {
  const trimmed = computer.trim();
  if (!trimmed) throw new Error("Computer name is empty");
  if (trimmed.includes("://")) return trimmed.replace(/\/$/, "");
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(trimmed) || trimmed.includes("]:")) return `http://${trimmed}`;
  if (trimmed.includes(":") && trimmed.includes(".")) return `http://${trimmed}`;
  const host = trimmed.replace(/:\d+$/, "");
  const explicitPort = trimmed.match(/:(\d+)$/)?.[1];
  return `http://${host}:${explicitPort ?? port}`;
}

async function pairFetch(url: string, bootstrapToken: string, init?: RequestInit): Promise<Response> {
  if (!bootstrapToken.trim()) throw new Error("Enter the host's bootstrap token to authorize pairing.");
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${bootstrapToken.trim()}`);
  try {
    return await fetch(url, { ...init, headers, signal: init?.signal ?? AbortSignal.timeout(FETCH_MS) });
  } catch {
    const host = url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    throw new Error(`Could not reach ${host}. Same Tailscale tailnet? Bridge running?`);
  }
}

export async function fetchPairSession(computer: string, bootstrapToken = ""): Promise<{ code: string; address: string; host: string }> {
  const res = await pairFetch(`${baseUrl(computer)}/pair`, bootstrapToken);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok || !record(body)) throw new Error(`Could not start pairing on ${computer} (${res.status})`);
  if (typeof body.code !== "string" || body.code.length !== 6 || typeof body.address !== "string") throw new Error("Invalid response from bridge");
  return { code: body.code, address: body.address, host: typeof body.host === "string" ? body.host : computer };
}

export async function claimLivePair(computer: string, bootstrapToken = ""): Promise<PairClaimResult> {
  const session = await fetchPairSession(computer, bootstrapToken);
  return claimPairCode(computer, session.code, undefined, bootstrapToken);
}

export async function startSonicPair(computer: string, claimKey: Uint8Array, bootstrapToken = ""): Promise<void> {
  const res = await pairFetch(`${baseUrl(computer)}/pair/intent`, bootstrapToken, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ claimKey: claimKeyToBase64Url(claimKey) }),
  });
  if (!res.ok) throw new Error(`Could not start pairing on ${computer} (${res.status})`);
}

export async function triggerPairBeep(computer: string, bootstrapToken = ""): Promise<void> {
  const res = await pairFetch(`${baseUrl(computer)}/pair/beep`, bootstrapToken, { method: "POST" });
  if (!res.ok) throw new Error(`Could not reach ${computer} (${res.status})`);
}

export async function hearPairTones(computer: string, claimKey: Uint8Array, audio: Uint8Array, mime: string, bootstrapToken = ""): Promise<PairClaimResult> {
  const res = await pairFetch(`${baseUrl(computer)}/pair/hear`, bootstrapToken, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ claimKey: claimKeyToBase64Url(claimKey), mime, audio: bytesToBase64(audio) }),
    signal: AbortSignal.timeout(20000),
  });
  return parseClaimResponse(res);
}

export async function claimPairCode(computer: string, code: string, claimKey?: Uint8Array, bootstrapToken = ""): Promise<PairClaimResult> {
  const payload: { code: string; claimKey?: string } = { code: code.trim().toUpperCase() };
  if (claimKey) payload.claimKey = claimKeyToBase64Url(claimKey);
  return parseClaimResponse(await pairFetch(`${baseUrl(computer)}/pair/claim`, bootstrapToken, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  }));
}

export async function claimPairAt(address: string, code: string, claimKey?: Uint8Array, bootstrapToken = ""): Promise<PairClaimResult> {
  return claimPairCode(address, code, claimKey, bootstrapToken);
}

async function parseClaimResponse(res: Response): Promise<PairClaimResult> {
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(record(body) && typeof body.error === "string" ? body.error : `Claim failed (${res.status})`);
  if (!record(body) || typeof body.address !== "string" || typeof body.token !== "string") throw new Error("Invalid response from bridge");
  return { address: body.address, token: body.token, host: typeof body.host === "string" ? body.host : "", cwd: typeof body.cwd === "string" ? body.cwd : "", harnesses: parseHarnesses(body.harnesses) ?? [] };
}

export function settingsFromClaim(claim: PairClaimResult, harness = "omp"): Settings {
  return { address: claim.address, token: claim.token, harness, inAppFeedback: true };
}
