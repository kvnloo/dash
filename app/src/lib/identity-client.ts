import { identityUrl, parseIdentityPairLink, pinnedKey, record, type IdentityPairLink } from "../../../shared/z0bridge-identity";

export interface IdentityEnrollment { url: string; issuer: string; kid: string; credentialId: string }
export const identitySecretKey = (id: string) => `dash.z0bridge.${id}`;

export function parseIdentityEnrollment(raw: unknown): IdentityEnrollment | undefined {
  if (!record(raw) || typeof raw.url !== "string" || !identityUrl(raw.url) || typeof raw.issuer !== "string" || !raw.issuer ||
      typeof raw.kid !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(raw.kid) || typeof raw.credentialId !== "string" || !/^cred_[0-9a-f]{16}$/.test(raw.credentialId)) return undefined;
  return { url: raw.url, issuer: raw.issuer, kid: raw.kid, credentialId: raw.credentialId };
}

async function jsonFetch(url: string, init: RequestInit, fetchImpl: (url: string, init?: RequestInit) => Promise<Response>): Promise<unknown> {
  const endpoint = new URL(url).pathname;
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(8000) });
  } catch { throw new Error(`z0bridge request failed at ${endpoint}. Check Tailscale and the host identity service.`); }
  // Never show the server body: it may echo an enrollment credential or token.
  if (!response.ok) throw new Error(`z0bridge ${endpoint}: HTTP ${response.status}. ${response.status === 403 ? "Requested scope was refused; ask the owner to review the grant." : response.status === 401 ? "Identity was refused; ask the owner to review enrollment." : "Host identity service unavailable; retry."}`);
  try { return await response.json(); }
  catch { throw new Error(`z0bridge ${endpoint}: invalid JSON response.`); }
}

/** Claim only after explicit owner confirmation. No persistence or automatic legacy replacement. */
export async function claimIdentity(link: IdentityPairLink, fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = fetch): Promise<{ enrollment: IdentityEnrollment; credential: string }> {
  const checked = parseIdentityPairLink(`dash://pair?v=2&url=${encodeURIComponent(link.url)}&code=${link.code}&kid=${link.kid}&app=${link.app}`);
  if (!checked) throw new Error("Invalid z0bridge pairing link");
  // Check the pinned public key BEFORE spending a single-use pairing code.
  const jwks = await jsonFetch(`${link.url}/.well-known/jwks.json`, {}, fetchImpl);
  if (!pinnedKey(jwks, link.kid)) throw new Error("z0bridge public key does not match the pairing link");
  const body = await jsonFetch(`${link.url}/v1/pair/claim`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: link.code }),
  }, fetchImpl);
  if (!record(body) || body.app !== "dash" || body.kind !== "client" || !Array.isArray(body.scopes) || !body.scopes.includes("dash:chat") ||
      typeof body.credential !== "string" || typeof body.credentialId !== "string" || !/^cred_[0-9a-f]{16}$/.test(body.credentialId) ||
      !new RegExp(`^z0bc\\.${body.credentialId}\\.[A-Za-z0-9_-]{43}$`).test(body.credential) ||
      body.kid !== link.kid || !pinnedKey(body.jwks, link.kid)) throw new Error("Invalid z0bridge claim response");
  const enrollment = parseIdentityEnrollment({ url: link.url, kid: link.kid, issuer: body.issuer, credentialId: body.credentialId });
  if (!enrollment) throw new Error("Invalid z0bridge enrollment");
  return { enrollment, credential: body.credential };
}

/** Cache short-lived access tokens in memory only; the long-lived credential stays in SecureStore. */
export class IdentityTokens {
  private cached = new Map<string, { token: string; until: number }>();
  constructor(private loadSecret: (key: string) => Promise<string | null>, private fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = fetch, private now = Date.now) {}
  clear(): void { this.cached.clear(); }
  async token(enrollment: IdentityEnrollment, audience: "dash" | "z0live" = "dash"): Promise<string> {
    const checked = parseIdentityEnrollment(enrollment);
    if (!checked) throw new Error("Invalid z0bridge settings");
    const scope = audience === "dash" ? "dash:chat" : "z0live:voice";
    const key = `${checked.url}|${checked.kid}|${checked.issuer}|${checked.credentialId}|${audience}`;
    const cached = this.cached.get(key);
    if (cached && cached.until > this.now() + 15_000) return cached.token;
    const credential = await this.loadSecret(identitySecretKey(checked.credentialId));
    if (!credential || !credential.startsWith(`z0bc.${checked.credentialId}.`)) throw new Error("z0bridge credential missing; pair again");
    // Pin key on each refresh, including after app restart.
    if (!pinnedKey(await jsonFetch(`${checked.url}/.well-known/jwks.json`, {}, this.fetchImpl), checked.kid)) throw new Error("z0bridge public key changed; pair again");
    const started = this.now();
    const result = await jsonFetch(`${checked.url}/v1/token`, {
      method: "POST", headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
      body: JSON.stringify({ aud: audience, scope: [scope], ttl: 120 }),
    }, this.fetchImpl);
    if (!record(result) || result.aud !== audience || result.token_type !== "Bearer" || result.scope !== scope ||
        typeof result.access_token !== "string" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(result.access_token) ||
        typeof result.expires_in !== "number" || !Number.isInteger(result.expires_in) || result.expires_in < 30 || result.expires_in > 300) throw new Error("Invalid z0bridge token response");
    this.cached.set(key, { token: result.access_token, until: started + result.expires_in * 1000 });
    return result.access_token;
  }
}
