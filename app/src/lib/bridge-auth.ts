import { IdentityTokens, type IdentityEnrollment } from "./identity-client";
import { loadIdentitySecret } from "./identity-secret";

const tokens = new IdentityTokens(key => loadIdentitySecret(key), (url, init) => fetch(url, init));
export function clearIdentityTokens(): void { tokens.clear(); }
export async function voiceAccessToken(settings: AuthSettings): Promise<string> {
  if (!settings.identity) throw new Error("Native voice requires z0bridge enrollment and a reviewed z0live:voice grant.");
  return tokens.token(settings.identity, "z0live");
}
export interface AuthSettings { token: string; identity?: IdentityEnrollment }

export async function executionToken(settings: AuthSettings): Promise<string> {
  // Identity failures never silently fall back to a legacy token.
  return settings.identity ? tokens.token(settings.identity) : settings.token;
}

export function socketUrl(settings: { address: string; token: string; identity?: IdentityEnrollment }): string {
  const base = `ws://${settings.address}/ws`;
  return settings.identity ? base : `${base}?token=${encodeURIComponent(settings.token.trim())}`;
}
