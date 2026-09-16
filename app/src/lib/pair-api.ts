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

const FETCH_MS = 8000;

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

async function pairFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(FETCH_MS) });
  } catch {
    const host = url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    throw new Error(`Could not reach ${host}. Same Tailscale tailnet? Bridge running?`);
  }
}

/** Live unbound session from the laptop (code + address). */
export async function fetchPairSession(computer: string): Promise<{ code: string; address: string; host: string }> {
  const res = await pairFetch(`${baseUrl(computer)}/pair`);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok || typeof body !== "object" || body === null) {
    throw new Error(`Could not start pairing on ${computer} (${res.status})`);
  }
  const rec = body as { code?: unknown; address?: unknown; host?: unknown };
  if (typeof rec.code !== "string" || rec.code.length !== 6 || typeof rec.address !== "string") {
    throw new Error("Invalid response from bridge");
  }
  return { code: rec.code, address: rec.address, host: typeof rec.host === "string" ? rec.host : computer };
}

/** One-tap pair over Tailscale: claim the laptop's current printed code. */
export async function claimLivePair(computer: string): Promise<PairClaimResult> {
  const session = await fetchPairSession(computer);
  return claimPairCode(computer, session.code);
}

/** Register phone secret over Tailscale, then laptop plays tones (code stays in audio only). */
export async function startSonicPair(computer: string, claimKey: Uint8Array): Promise<void> {
  const res = await pairFetch(`${baseUrl(computer)}/pair/intent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ claimKey: claimKeyToBase64Url(claimKey) }),
  });
  if (!res.ok) throw new Error(`Could not start pairing on ${computer} (${res.status})`);
}

/** Legacy curl beep — not used by the app anymore. */
export async function triggerPairBeep(computer: string): Promise<void> {
  const res = await pairFetch(`${baseUrl(computer)}/pair/beep`, { method: "POST" });
  if (!res.ok) throw new Error(`Could not reach ${computer} (${res.status})`);
}

/** Upload the mic clip; laptop ffmpeg-decodes tones and claims the session. */
export async function hearPairTones(
  computer: string,
  claimKey: Uint8Array,
  audio: Uint8Array,
  mime: string,
): Promise<PairClaimResult> {
  const res = await pairFetch(`${baseUrl(computer)}/pair/hear`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      claimKey: claimKeyToBase64Url(claimKey),
      mime,
      audio: bytesToBase64(audio),
    }),
    signal: AbortSignal.timeout(20000),
  });
  return parseClaimResponse(res);
}

export async function claimPairCode(
  computer: string,
  code: string,
  claimKey?: Uint8Array,
): Promise<PairClaimResult> {
  const payload: { code: string; claimKey?: string } = { code: code.trim().toUpperCase() };
  if (claimKey) payload.claimKey = claimKeyToBase64Url(claimKey);
  const res = await pairFetch(`${baseUrl(computer)}/pair/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseClaimResponse(res);
}

export async function claimPairAt(
  address: string,
  code: string,
  claimKey?: Uint8Array,
): Promise<PairClaimResult> {
  const payload: { code: string; claimKey?: string } = { code: code.trim().toUpperCase() };
  if (claimKey) payload.claimKey = claimKeyToBase64Url(claimKey);
  const res = await pairFetch(`http://${address.replace(/^https?:\/\//, "")}/pair/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseClaimResponse(res);
}

async function parseClaimResponse(res: Response): Promise<PairClaimResult> {
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : `Claim failed (${res.status})`;
    throw new Error(message);
  }
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as PairClaimResult).address !== "string" ||
    typeof (body as PairClaimResult).token !== "string"
  ) {
    throw new Error("Invalid response from bridge");
  }
  return body as PairClaimResult;
}

export function settingsFromClaim(claim: PairClaimResult, harness = "omp"): Settings {
  return { address: claim.address, token: claim.token, harness, inAppFeedback: true };
}
