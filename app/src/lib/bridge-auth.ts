import { IdentityTokens, type IdentityEnrollment } from "./identity-client";
import { loadIdentitySecret } from "./identity-secret";

const tokens = new IdentityTokens(key => loadIdentitySecret(key), (url, init) => fetch(url, init));
export function clearIdentityTokens(): void { tokens.clear(); }
export async function voiceAccessToken(settings: AuthSettings): Promise<string> {
  if (!settings.identity) throw new Error("Native voice requires z0bridge enrollment and a reviewed z0live:voice grant.");
  return tokens.token(settings.identity, "z0live");
}
export interface AuthSettings { token: string; identity?: IdentityEnrollment }

/**
 * Upper bound for one identity token acquisition (secure-store read + JWKS + /v1/token).
 * The socket connect timer starts only after this resolves, so an unbounded wait here
 * would stall the connect loop with no socket and no retry.
 */
export const EXECUTION_TOKEN_TIMEOUT_MS = 20_000;

export async function executionToken(settings: AuthSettings, timeoutMs = EXECUTION_TOKEN_TIMEOUT_MS): Promise<string> {
  // Identity failures never silently fall back to a legacy token.
  if (!settings.identity) return settings.token;
  return withDeadline(tokens.token(settings.identity), timeoutMs, "Timed out getting a z0bridge identity token");
}

function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export function socketUrl(settings: { address: string; token: string; identity?: IdentityEnrollment }): string {
  const base = `ws://${settings.address}/ws`;
  return settings.identity ? base : `${base}?token=${encodeURIComponent(settings.token.trim())}`;
}
