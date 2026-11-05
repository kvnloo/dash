import { createPublicKey, verify } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { identityUrl, pinnedKey, record } from "../../shared/z0bridge-identity";
import { bearerToken, secretMatches } from "./bridge-security";

type Env = Record<string, string | undefined>;
export interface LocalCredential { credential: string; scopes: string[]; url: string }

/** Never creates, repairs or prints credentials. Only explicitly selected private files. */
export function readLocalCredential(path: string, scopes: string[]): LocalCredential | undefined {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || (stat.mode & 0o077)) return undefined;
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!record(value) || value.app !== "dash" || typeof value.credential !== "string" ||
        !/^z0bc\.cred_[0-9a-f]{16}\.[A-Za-z0-9_-]{43}$/.test(value.credential) ||
        typeof value.url !== "string" || !identityUrl(value.url, true) || !Array.isArray(value.scopes) ||
        !value.scopes.every((s): s is string => typeof s === "string") || !scopes.every(s => Array.isArray(value.scopes) && value.scopes.includes(s))) return undefined;
    return { credential: value.credential, url: value.url, scopes: value.scopes };
  } catch { return undefined; }
}

export type BridgePrincipal = { kind: "legacy" } | { kind: "identity"; token: string; expiresAt: number; subject: string };
export interface IdentityOptions {
  url: string;
  issuer: string;
  kid: string;
  credential(): string | undefined;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  recheckMs?: number;
}

export class DashIdentity {
  private key?: ReturnType<typeof createPublicKey>;
  constructor(private options: IdentityOptions) {
    if (!identityUrl(options.url, true) || !options.issuer || !/^[A-Za-z0-9_-]{43}$/.test(options.kid)) throw new Error("Invalid Dash identity configuration");
  }
  private get now(): number { return (this.options.now ?? Date.now)(); }
  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await (this.options.fetch ?? fetch)(`${this.options.url}${path}`, {
      ...init, redirect: "error", signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error("Identity unavailable");
    return response.json();
  }
  async offline(token: string): Promise<BridgePrincipal | undefined> {
    try {
      if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return undefined;
      const [headerPart = "", bodyPart = "", signaturePart = ""] = token.split(".");
      const header: unknown = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8"));
      if (!record(header) || header.alg !== "ES256" || header.typ !== "at+jwt" || header.kid !== this.options.kid) return undefined;
      if (!this.key) {
        const key = pinnedKey(await this.request("/.well-known/jwks.json"), this.options.kid);
        if (!key) return undefined;
        this.key = createPublicKey({ key, format: "jwk" });
      }
      const signature = Buffer.from(signaturePart, "base64url");
      if (signature.length !== 64 || !verify("sha256", Buffer.from(`${headerPart}.${bodyPart}`), { key: this.key, dsaEncoding: "ieee-p1363" }, signature)) return undefined;
      const c: unknown = JSON.parse(Buffer.from(bodyPart, "base64url").toString("utf8"));
      const now = Math.floor(this.now / 1000);
      if (!record(c) || c.iss !== this.options.issuer || c.aud !== "dash" || typeof c.scope !== "string" || !c.scope.split(" ").includes("dash:chat") ||
          typeof c.sub !== "string" || !c.sub.startsWith("cred_") || typeof c.dev !== "string" || !c.dev.startsWith("dev_") ||
          typeof c.app !== "string" || typeof c.jti !== "string" || !c.jti ||
          typeof c.iat !== "number" || !Number.isInteger(c.iat) || typeof c.nbf !== "number" || !Number.isInteger(c.nbf) ||
          typeof c.exp !== "number" || !Number.isInteger(c.exp) || c.exp <= now || c.nbf > now || c.iat > now ||
          c.exp <= c.iat || c.exp - c.iat > 300 || c.nbf < c.iat) return undefined;
      return { kind: "identity", token, expiresAt: c.exp * 1000, subject: c.sub };
    } catch { return undefined; }
  }
  async active(principal: BridgePrincipal): Promise<boolean> {
    if (principal.kind === "legacy") return true;
    if (principal.expiresAt <= this.now) return false;
    try {
      const credential = this.options.credential();
      if (!credential) return false;
      const result = await this.request("/v1/introspect", {
        method: "POST", headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
        body: JSON.stringify({ token: principal.token }),
      });
      return record(result) && result.active === true && result.token_type === "access" && result.sub === principal.subject &&
        result.aud === "dash" && typeof result.scope === "string" && result.scope.split(" ").includes("dash:chat") &&
        typeof result.exp === "number" && result.exp * 1000 === principal.expiresAt && result.exp * 1000 > this.now;
    } catch { return false; }
  }
  /** Fail closed on revocation, scope removal, expiry or identity outage. No legacy socket timer. */
  watch(principal: BridgePrincipal, close: () => void): () => void {
    if (principal.kind === "legacy") return () => {};
    let stopped = false;
    let pending = false;
    const check = async () => {
      if (stopped || pending) return;
      pending = true;
      const active = await this.active(principal);
      pending = false;
      if (!stopped && !active) { stop(); close(); }
    };
    const interval = setInterval(() => void check(), this.options.recheckMs ?? 60_000);
    const expiry = setTimeout(() => { if (!stopped) { stop(); close(); } }, Math.max(0, principal.expiresAt - this.now));
    const stop = () => { stopped = true; clearInterval(interval); clearTimeout(expiry); };
    return stop;
  }
}

export function configuredIdentity(env: Env = process.env): DashIdentity | undefined {
  if (env.DASH_IDENTITY !== "1") return undefined;
  const path = env.DASH_IDENTITY_CREDENTIAL_FILE;
  if (!path || !env.DASH_IDENTITY_ISSUER || !env.DASH_IDENTITY_KID) throw new Error("Dash identity opt-in requires issuer, pinned kid and an introspection credential file");
  if (!readLocalCredential(path, ["z0bridge:introspect"])) throw new Error("Invalid Dash introspection credential file");
  return new DashIdentity({
    url: env.DASH_IDENTITY_URL ?? "http://127.0.0.1:4789", issuer: env.DASH_IDENTITY_ISSUER, kid: env.DASH_IDENTITY_KID,
    recheckMs: 1000 * Math.min(300, Math.max(1, Number(env.DASH_IDENTITY_RECHECK_SECONDS) || 60)),
    credential: () => readLocalCredential(path, ["z0bridge:introspect"])?.credential,
  });
}

export class BridgeAuth {
  constructor(private token: string, readonly identity?: DashIdentity, private legacy = true) {}
  async authenticate(request: Request, queryLegacy = false, online = false): Promise<BridgePrincipal | undefined> {
    const supplied = bearerToken(request) ?? (queryLegacy ? new URL(request.url).searchParams.get("token") : null);
    if (this.legacy && secretMatches(supplied, this.token)) return { kind: "legacy" };
    // A JWT in a URL is never tried as an identity credential.
    const header = bearerToken(request);
    if (!this.identity || !header) return undefined;
    const principal = await this.identity.offline(header);
    if (!principal || (online && !await this.identity.active(principal))) return undefined;
    return principal;
  }
}
