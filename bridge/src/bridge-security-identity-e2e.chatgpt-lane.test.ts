import { describe, expect, test } from "bun:test";
import { identityFixture } from "../../shared/identity-fixture.test-helper";
import { createPairingSessions } from "../pair";
import { createPairingHttpHandler } from "./pairing-http";
import { BridgeAuth, DashIdentity } from "./z0bridge-identity";

function setup(legacyEnabled: boolean) {
  const fixture = identityFixture();
  let revoked = false;
  let checks = 0;
  const identity = new DashIdentity({
    url: "http://127.0.0.1:4789",
    issuer: fixture.issuer,
    kid: fixture.kid,
    credential: () => "isolated-fixture-credential",
    recheckMs: 5,
    fetch: async (url, init) => {
      if (url.endsWith("/.well-known/jwks.json")) return Response.json(fixture.jwks);
      checks++;
      const body: unknown = JSON.parse(String(init?.body));
      const token = typeof body === "object" && body !== null && "token" in body ? body.token : undefined;
      let claims: unknown;
      try {
        const encoded = typeof token === "string" ? token.split(".")[1] : undefined;
        claims = encoded ? JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) : null;
      } catch {
        claims = null;
      }
      const parsed = typeof claims === "object" && claims !== null &&
        "sub" in claims && "exp" in claims && "aud" in claims && "scope" in claims ? claims : null;
      const valid = parsed !== null;
      return Response.json({
        active: !revoked && valid,
        token_type: "access",
        aud: parsed ? parsed.aud : null,
        scope: parsed ? parsed.scope : null,
        sub: parsed ? parsed.sub : null,
        exp: parsed ? parsed.exp : null,
      });
    },
  });
  const legacy = "isolated-legacy-token";
  const bootstrap = "isolated-bootstrap-token-not-for-execution";
  const auth = new BridgeAuth(legacy, identity, legacyEnabled);
  const handler = createPairingHttpHandler({
    bootstrapToken: bootstrap,
    token: legacy,
    authorize: async (request, queryLegacy) => Boolean(await auth.authenticate(request, queryLegacy)),
    legacyEnabled,
    hostname: "fixture-host",
    address: "100.90.10.4:4747",
    cwd: "/fixture",
    harnesses: () => [],
    roster: () => [{ id: "fixture-host" }],
    pairing: createPairingSessions(),
    playCode: () => {},
    decodeAudio: async () => null,
  });
  const request = (path: string, token?: string) => new Request("http://100.90.10.4:4747" + path, token
    ? { headers: { authorization: "Bearer " + token } } : {});
  const http = (path: string, token?: string) => handler(request(path, token), "100.90.10.5");
  return {
    fixture, legacy, bootstrap, auth, identity, request, http,
    revoke: () => { revoked = true; },
    checks: () => checks,
  };
}

describe("z0bridge identity at actual pairing/roster HTTP boundary", () => {
  test("signed Dash scope works in a header; other audiences and query JWTs are rejected", async () => {
    const x = setup(true);
    const signed = x.fixture.token();
    expect((await x.http("/", signed))?.status).toBe(200);
    expect((await x.http("/roster", signed))?.status).toBe(200);
    expect((await x.http("/roster?token=" + encodeURIComponent(signed)))?.status).toBe(401);
    expect((await x.http("/roster", x.fixture.token({ aud: "noop" })))?.status).toBe(401);
    expect((await x.http("/roster", x.fixture.token({ scope: "dash:other" })))?.status).toBe(401);
    expect((await x.http("/roster", x.fixture.token({ exp: 1 })))?.status).toBe(401);
    expect((await x.http("/roster?token=" + x.legacy))?.status).toBe(200);
    expect((await x.http("/roster", x.bootstrap))?.status).toBe(401);
  });

  test("legacy switch disables both bootstrap pairing and legacy execution, without disabling identity", async () => {
    const x = setup(false);
    expect((await x.http("/pair", x.bootstrap))?.status).toBe(401);
    expect((await x.http("/roster", x.legacy))?.status).toBe(401);
    expect((await x.http("/roster?token=" + x.legacy))?.status).toBe(401);
    expect((await x.http("/", x.bootstrap))?.status).toBe(401);
    expect((await x.http("/roster", x.fixture.token()))?.status).toBe(200);
  });

  test("upgrade requires online introspection and existing identities fail closed on revocation", async () => {
    const x = setup(true);
    const request = x.request("/ws", x.fixture.token());
    const principal = await x.auth.authenticate(request, true, true);
    expect(principal?.kind).toBe("identity");
    expect(x.checks()).toBe(1);
    if (!principal) throw new Error("Fixture identity failed verification");

    let closed = 0;
    const stop = x.identity.watch(principal, () => { closed++; });
    try {
      x.revoke();
      expect(await x.auth.authenticate(request, true, true)).toBeUndefined();
      await Bun.sleep(35);
      expect(closed).toBe(1);
      expect(x.checks()).toBeGreaterThanOrEqual(3);
      expect(await x.auth.authenticate(x.request("/ws?token=" + encodeURIComponent(x.fixture.token())), true, true)).toBeUndefined();
      expect(await x.auth.authenticate(x.request("/ws?token=" + x.legacy), true, true)).toEqual({ kind: "legacy" });
    } finally {
      stop();
    }
  });
});
