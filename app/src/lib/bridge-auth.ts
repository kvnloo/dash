import { IdentityTokens, type IdentityEnrollment } from "./identity-client";

const tokens = new IdentityTokens(async key => (await import("./secure")).getSecret(key), (url, init) => fetch(url, init));
export function clearIdentityTokens(): void { tokens.clear(); }
export interface AuthSettings { token: string; identity?: IdentityEnrollment }

export async function executionToken(settings: AuthSettings): Promise<string> {
  // Identity failures never silently fall back to a legacy token.
  return settings.identity ? tokens.token(settings.identity) : settings.token;
}

export function socketUrl(settings: { address: string; token: string; identity?: IdentityEnrollment }): string {
  const base = `ws://${settings.address}/ws`;
  return settings.identity ? base : `${base}?token=${encodeURIComponent(settings.token.trim())}`;
}
