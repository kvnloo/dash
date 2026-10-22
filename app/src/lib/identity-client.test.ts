import { expect, test } from "bun:test";
import { identityFixture } from "../../../shared/identity-fixture.test-helper";
import { claimIdentity, identitySecretKey, IdentityTokens, parseIdentityEnrollment } from "./identity-client";
import { socketUrl } from "./bridge-auth";
import { parseSettings } from "../model";

test("voice mint is a separate exact audience/scope and cannot reuse the chat cache", async () => {
  const x = fixture(); const bodies: unknown[] = [];
  const request = async (url: string, init?: RequestInit) => {
    if (url.endsWith("jwks.json")) return Response.json(x.f.jwks);
    const body = JSON.parse(String(init?.body)); bodies.push(body);
    return Response.json({ access_token: x.f.token(), token_type: "Bearer", expires_in: 120, scope: body.aud === "z0live" ? "z0live:voice" : "dash:chat", aud: body.aud });
  };
  const tokens = new IdentityTokens(async () => x.credential, request);
  await tokens.token(x.enrollment); await tokens.token(x.enrollment, "z0live"); await tokens.token(x.enrollment);
  expect(bodies).toEqual([{ aud: "dash", scope: ["dash:chat"], ttl: 120 }, { aud: "z0live", scope: ["z0live:voice"], ttl: 120 }]);
  // An identity service that only permits dash:chat cannot be treated as voice authorization.
  await expect(new IdentityTokens(async () => x.credential, x.fetchImpl).token(x.enrollment, "z0live")).rejects.toThrow("token response");
});

function fixture() {
  const f = identityFixture();
  const enrollment = { url: "http://100.113.138.100:4788", issuer: f.issuer, kid: f.kid, credentialId: "cred_0123456789abcdef" };
  const credential = `z0bc.${enrollment.credentialId}.${"s".repeat(43)}`;
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = async (input, init) => {
    const url = String(input); calls.push({ url, init });
    if (url.endsWith("jwks.json")) return Response.json(f.jwks);
    if (url.endsWith("/claim")) return Response.json({ ...enrollment, app: "dash", kind: "client", scopes: ["dash:chat"], credential, jwks: f.jwks }, { status: 201 });
    return Response.json({ access_token: f.token(), token_type: "Bearer", expires_in: 120, scope: "dash:chat", aud: "dash" });
  };
  return { f, enrollment, credential, calls, fetchImpl, link: { url: enrollment.url, code: `z0bp_${"c".repeat(43)}`, kid: f.kid, app: "dash" as const } };
}

test("claim pins JWKS before spending the exact opaque code; only metadata belongs in settings", async () => {
  const x = fixture();
  const claimed = await claimIdentity(x.link, x.fetchImpl);
  expect(claimed.enrollment).toEqual(x.enrollment);
  expect(claimed.credential).toBe(x.credential);
  expect(x.calls.map(c => c.url)).toEqual([`${x.enrollment.url}/.well-known/jwks.json`, `${x.enrollment.url}/v1/pair/claim`]);
  expect(JSON.parse(String(x.calls[1]?.init?.body))).toEqual({ code: x.link.code });
  const settings = parseSettings({ address: "100.113.138.100:4747", token: "", harness: "omp", identity: claimed.enrollment });
  expect(settings?.identity).toEqual(x.enrollment);
  expect(JSON.stringify(settings).includes(x.credential)).toBe(false);
  expect(identitySecretKey(x.enrollment.credentialId)).toBe(`dash.z0bridge.${x.enrollment.credentialId}`);
});

test("key mismatch refuses before claim; malformed/unscoped claim responses are rejected", async () => {
  const x = fixture(); let count = 0;
  const mismatch: (url: string, init?: RequestInit) => Promise<Response> = async () => { count++; return Response.json(identityFixture().jwks); };
  await expect(claimIdentity(x.link, mismatch)).rejects.toThrow("public key"); expect(count).toBe(1);
  for (const changes of [{ app: "noop" }, { kind: "resource" }, { scopes: [] }, { credential: "bad" }, { kid: "bad" }, { credentialId: ".*" }, { issuer: null }]) {
    const bad: (url: string, init?: RequestInit) => Promise<Response> = async input => String(input).endsWith("jwks.json") ? Response.json(x.f.jwks) : Response.json({ ...x.enrollment, app: "dash", kind: "client", scopes: ["dash:chat"], credential: x.credential, jwks: x.f.jwks, ...changes });
    await expect(claimIdentity(x.link, bad)).rejects.toThrow();
  }
});

test("mint aud=dash and only dash:chat; cache in memory, refresh before expiry", async () => {
  const x = fixture(); let now = Date.now(); const loaded: string[] = [];
  const tokens = new IdentityTokens(async key => { loaded.push(key); return x.credential; }, x.fetchImpl, () => now);
  const one = await tokens.token(x.enrollment);
  expect(await tokens.token(x.enrollment)).toBe(one);
  expect(loaded).toEqual([identitySecretKey(x.enrollment.credentialId)]);
  expect(x.calls).toHaveLength(2);
  expect(JSON.parse(String(x.calls[1]?.init?.body))).toEqual({ aud: "dash", scope: ["dash:chat"], ttl: 120 });
  expect(new Headers(x.calls[1]?.init?.headers).get("authorization")).toBe(`Bearer ${x.credential}`);
  now += 106000; await tokens.token(x.enrollment); expect(loaded).toHaveLength(2); expect(x.calls).toHaveLength(4);
});

test("missing credential and service failure never return a legacy token", async () => {
  const x = fixture();
  await expect(new IdentityTokens(async () => null, x.fetchImpl).token(x.enrollment)).rejects.toThrow("missing");
  await expect(new IdentityTokens(async () => x.credential, async () => { throw new Error("offline"); }).token(x.enrollment)).rejects.toThrow("request failed");
  for (const response of [{ token_type: "Basic" }, { aud: "noop" }, { scope: "dash:other" }, { expires_in: 999 }, { access_token: "not-jwt" }]) {
    const bad: (url: string, init?: RequestInit) => Promise<Response> = async input => String(input).endsWith("jwks.json") ? Response.json(x.f.jwks) : Response.json({ access_token: x.f.token(), token_type: "Bearer", aud: "dash", scope: "dash:chat", expires_in: 120, ...response });
    await expect(new IdentityTokens(async () => x.credential, bad).token(x.enrollment)).rejects.toThrow("token response");
  }
});

test("identity metadata fails closed on hydration; legacy settings and query WS stay compatible", () => {
  const x = fixture();
  const legacy = { address: "100.113.138.100:4747", token: "legacy-fixture", harness: "omp", inAppFeedback: true };
  expect(parseSettings(legacy)?.token).toBe(legacy.token);
  expect(socketUrl(legacy)).toBe(`ws://${legacy.address}/ws?token=legacy-fixture`);
  expect(socketUrl({ ...legacy, identity: x.enrollment })).toBe(`ws://${legacy.address}/ws`);
  expect(parseSettings({ ...legacy, identity: { ...x.enrollment, url: "http://evil:80" } })).toBeNull();
  expect(parseIdentityEnrollment({ ...x.enrollment, credentialId: "bad" })).toBeUndefined();
});
