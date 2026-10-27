import { createHash, generateKeyPairSync, sign } from "node:crypto";

/** Disposable ES256 authority, matching z0bridge PR #2's wire format. No live state. */
export function identityFixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const raw = publicKey.export({ format: "jwk" });
  if (!raw.x || !raw.y) throw new Error("Missing fixture coordinates");
  const kid = createHash("sha256").update(`{"crv":"P-256","kty":"EC","x":"${raw.x}","y":"${raw.y}"}`).digest("base64url");
  const jwks = { keys: [{ kty: "EC", crv: "P-256", x: raw.x, y: raw.y, kid, alg: "ES256", use: "sig" }] };
  const issuer = "z0bridge:isolated-test";
  const claims = (changes: Record<string, unknown> = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return { iss: issuer, aud: "dash", sub: "cred_0123456789abcdef", dev: "dev_0123456789abcdef", app: "dash", scope: "dash:chat", iat: now, nbf: now, exp: now + 120, jti: "fixture", ...changes };
  };
  const token = (changes: Record<string, unknown> = {}, headers: Record<string, unknown> = {}) => {
    const h = Buffer.from(JSON.stringify({ alg: "ES256", typ: "at+jwt", kid, ...headers })).toString("base64url");
    const b = Buffer.from(JSON.stringify(claims(changes))).toString("base64url");
    const s = sign("sha256", Buffer.from(`${h}.${b}`), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
    return `${h}.${b}.${s}`;
  };
  return { jwks, kid, issuer, token, claims };
}
