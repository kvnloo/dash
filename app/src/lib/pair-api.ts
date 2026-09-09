import type { HarnessInfo } from "../../../shared/protocol";
import type { Settings } from "../model";
import { claimKeyToBase64Url } from "./pair-crypto";

export interface PairClaimResult {
  address: string;
  token: string;
  host: string;
  cwd: string;
  harnesses: HarnessInfo[];
}

function baseUrl(computer: string, port = 4747): string {
  const trimmed = computer.trim().replace(/:\d+$/, "");
  if (trimmed.includes(":")) return `http://${trimmed}`;
  return `http://${trimmed}:${port}`;
}

/** Register phone secret over Tailscale, then laptop plays tones (code stays in audio only). */
export async function startSonicPair(computer: string, claimKey: Uint8Array): Promise<void> {
  const res = await fetch(`${baseUrl(computer)}/pair/intent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ claimKey: claimKeyToBase64Url(claimKey) }),
  });
  if (!res.ok) throw new Error(`Could not start pairing on ${computer} (${res.status})`);
}

/** Legacy curl beep — not used by the app anymore. */
export async function triggerPairBeep(computer: string): Promise<void> {
  const res = await fetch(`${baseUrl(computer)}/pair/beep`, { method: "POST" });
  if (!res.ok) throw new Error(`Could not reach ${computer} (${res.status})`);
}

export async function claimPairCode(
  computer: string,
  code: string,
  claimKey?: Uint8Array,
): Promise<PairClaimResult> {
  const payload: { code: string; claimKey?: string } = { code: code.trim().toUpperCase() };
  if (claimKey) payload.claimKey = claimKeyToBase64Url(claimKey);
  const res = await fetch(`${baseUrl(computer)}/pair/claim`, {
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
  const res = await fetch(`http://${address.replace(/^https?:\/\//, "")}/pair/claim`, {
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
  return { address: claim.address, token: claim.token, harness };
}
