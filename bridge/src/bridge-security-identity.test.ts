import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identityFixture } from "../../shared/identity-fixture.test-helper";
import { BridgeAuth, configuredIdentity, DashIdentity, readLocalCredential } from "./z0bridge-identity";

function authority() {
  const f = identityFixture();
  let active = true; let available = true; let scope = "dash:chat"; let jwks = f.jwks;
  const calls: string[] = [];
  const fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = async (input, init) => {
    const url = String(input); calls.push(url);
    if (!available) throw new Error("isolated outage");
    if (url.endsWith("/.well-known/jwks.json")) return Response.json(jwks);
    expect(init?.redirect).toBe("error");
    const body: unknown = JSON.parse(String(init?.body));
    if (typeof body !== "object" || body === null || !("token" in body) || typeof body.token !== "string") throw new Error("missing fixture token");
    const claims: unknown = JSON.parse(Buffer.from(body.token.split(".")[1] ?? "", "base64url").toString());
    if (typeof claims !== "object" || claims === null || !("sub" in claims) || !("exp" in claims)) throw new Error("bad fixture claims");
    return Response.json({ active, token_type: "access", aud: "dash", scope, sub: claims.sub, exp: claims.exp });
  };
  const identity = new DashIdentity({ url: "http://127.0.0.1:4789", issuer: f.issuer, kid: f.kid, credential: () => "isolated-introspection-credential", fetch: fetchImpl, recheckMs: 10 });
  return { f, identity, calls, revoke: () => { active = false; }, outage: () => { available = false; }, removeScope: () => { scope = "dash:other"; }, wrongKey: () => { jwks = identityFixture().jwks; } };
}
const request = (token: string) => new Request("http://127.0.0.1/ws", { headers: { authorization: `Bearer ${token}` } });

describe("bridge identity security", () => {
  test("identity is opt-in; legacy header and query defaults work without identity I/O", async () => {
    expect(configuredIdentity({})).toBeUndefined();
    expect(configuredIdentity({ DASH_IDENTITY: "0", DASH_IDENTITY_CREDENTIAL_FILE: "/unread" })).toBeUndefined();
    const auth = new BridgeAuth("legacy-fixture");
    expect(await auth.authenticate(request("legacy-fixture"))).toEqual({ kind: "legacy" });
    expect(await auth.authenticate(new Request("http://127.0.0.1/ws?token=legacy-fixture"), true)).toEqual({ kind: "legacy" });
    expect(await auth.authenticate(request(authority().f.token()))).toBeUndefined();
    expect(await new BridgeAuth("legacy-fixture", undefined, false).authenticate(request("legacy-fixture"))).toBeUndefined();
    expect(() => configuredIdentity({ DASH_IDENTITY: "1" })).toThrow();
  });
  test("valid ES256 aud=dash dash:chat is verified offline; upgrade adds introspection", async () => {
    const a = authority(); const token = a.f.token(); const auth = new BridgeAuth("legacy-fixture", a.identity);
    expect((await auth.authenticate(request(token)))?.kind).toBe("identity");
    expect(a.calls).toHaveLength(1);
    expect((await auth.authenticate(request(token), true, true))?.kind).toBe("identity");
    expect(a.calls).toHaveLength(2);
    expect(await auth.authenticate(new Request(`http://127.0.0.1/ws?token=${token}`), true, true)).toBeUndefined();
    a.outage();
    expect((await auth.authenticate(request(token)))?.kind).toBe("identity"); // pinned JWKS is cached
    expect(await auth.authenticate(request(token), true, true)).toBeUndefined();
    expect(await auth.authenticate(request("legacy-fixture"), true, true)).toEqual({ kind: "legacy" });
  });
  test("rejects wrong issuer/audience/scope, malformed claims, algorithm confusion and invalid signatures", async () => {
    const a = authority();
    const now = Math.floor(Date.now() / 1000);
    for (const claims of [{ iss: "other" }, { aud: "noop" }, { aud: ["dash"] }, { scope: "dash:other" }, { scope: ["dash:chat"] }, { exp: now }, { nbf: now + 60 }, { iat: now + 60 }, { iat: now - 500 }, { exp: "later" }, { sub: 7 }, { dev: "" }, { jti: null }, { nbf: now - 60 }]) expect(await a.identity.offline(a.f.token(claims))).toBeUndefined();
    for (const header of [{ alg: "HS256" }, { alg: "none" }, { typ: "JWT" }, { kid: "other" }]) expect(await a.identity.offline(a.f.token({}, header))).toBeUndefined();
    const token = a.f.token(); const parts = token.split(".");
    expect(await a.identity.offline(`${parts[0]}.${Buffer.from(JSON.stringify(a.f.claims({ aud: "noop" }))).toString("base64url")}.${parts[2]}`)).toBeUndefined();
    for (const raw of ["", "x.y.z", token + "x", "a".repeat(4097), token.slice(0, -20)]) expect(await a.identity.offline(raw)).toBeUndefined();
  });
  test("a JWKS carrying a forged kid is not trusted", async () => {
    const a = authority(); a.wrongKey();
    expect(await a.identity.offline(a.f.token())).toBeUndefined();
  });
  for (const reason of ["revoked", "scope removed", "identity outage"]) {
    test(`open identity sockets fail closed on ${reason}; legacy is unaffected`, async () => {
      const a = authority(); const principal = await a.identity.offline(a.f.token());
      if (!principal) throw new Error("fixture rejected");
      let closes = 0; let legacyCloses = 0;
      const stop = a.identity.watch(principal, () => closes++);
      const stopLegacy = a.identity.watch({ kind: "legacy" }, () => legacyCloses++);
      try {
        if (reason === "revoked") a.revoke(); else if (reason === "scope removed") a.removeScope(); else a.outage();
        await Bun.sleep(35);
        expect(closes).toBe(1); expect(legacyCloses).toBe(0);
      } finally { stop(); stopLegacy(); }
    });
  }
  test("socket expiry is independent of the introspection interval; close cleanup stops rechecks", async () => {
    const a = authority(); let closes = 0;
    const stop = a.identity.watch({ kind: "identity", token: a.f.token(), subject: "fixture", expiresAt: Date.now() + 5 }, () => closes++);
    await Bun.sleep(25); stop(); expect(closes).toBe(1);
    const principal = await a.identity.offline(a.f.token()); if (!principal) throw new Error("fixture rejected");
    const cancel = a.identity.watch(principal, () => closes++); cancel(); a.revoke();
    await Bun.sleep(25); expect(closes).toBe(1);
  });
  test("local enrollment requires private JSON, app and scopes; no credential file is created", () => {
    const dir = mkdtempSync(join(tmpdir(), "dash-enrollment-"));
    const path = join(dir, "credential.json");
    try {
      expect(readLocalCredential(path, [])).toBeUndefined();
      const data = { app: "dash", url: "http://127.0.0.1:4789", credential: `z0bc.cred_0123456789abcdef.${"x".repeat(43)}`, scopes: ["z0bridge:introspect"] };
      writeFileSync(path, JSON.stringify(data), { mode: 0o600 });
      expect(readLocalCredential(path, ["z0bridge:introspect"])?.url).toBe(data.url);
      expect(readLocalCredential(path, ["hermes:turns"])).toBeUndefined();
      chmodSync(path, 0o644); expect(readLocalCredential(path, [])).toBeUndefined();
      chmodSync(path, 0o600); writeFileSync(path, JSON.stringify({ ...data, app: "other" }));
      expect(readLocalCredential(path, [])).toBeUndefined();
      writeFileSync(path, "bad JSON"); expect(readLocalCredential(path, [])).toBeUndefined();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
