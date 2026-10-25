import { expect, mock, test } from "bun:test";
import { identityFixture } from "../../../shared/identity-fixture.test-helper";
import { clearIdentityTokens, executionToken, socketUrl } from "./bridge-auth";
import { headerSocket } from "./native-socket";
import { uploadAttachment, sendToPhone } from "./attachments";
import { fetchRoster } from "./roster";
import { fetchContextView } from "./context-api";

test("roster and attachment paths mint identity tokens and send header-only credentials", async () => {
  const f = identityFixture(); const access = f.token();
  const credential = `z0bc.cred_0123456789abcdef.${"x".repeat(43)}`;
  const secretKeys: string[] = [];
  mock.module("./secure", () => ({ getSecret: async (key: string) => { secretKeys.push(key); return credential; }, setSecret: async () => {} }));
  const settings = { address: "100.113.138.100:4747", token: "legacy-not-to-be-used", harness: "omp", inAppFeedback: true,
    identity: { url: "http://100.113.138.100:4788", issuer: f.issuer, kid: f.kid, credentialId: "cred_0123456789abcdef" } };
  const original = globalThis.fetch;
  const calls: string[] = [];
  let minted = 0;
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push(url);
    if (url.endsWith("jwks.json")) return Response.json(f.jwks);
    if (url.endsWith("/v1/token")) {
      minted++;
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${credential}`);
      return Response.json({ access_token: access, token_type: "Bearer", scope: "dash:chat", aud: "dash", expires_in: 120 });
    }
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${access}`);
    expect(url.includes("token=")).toBe(false);
    if ((url.includes("/chat/context?") || url.includes("/chat/usage?"))) return Response.json({ context: null, plans: [] });
    if (url.endsWith("/roster")) return Response.json({ hosts: [] });
    if (url.endsWith("/share")) return Response.json({ ok: true, message: "fixture only; no sharing invoked" });
    return Response.json({ id: "a".repeat(32), name: "test.txt", mime: "text/plain", size: 4 });
  }, { preconnect: original.preconnect });
  try {
    clearIdentityTokens();
    expect(await fetchRoster(settings)).toEqual([]);
    expect((await fetchContextView(settings, "omp", "default", "session")).context).toBeUndefined();
    expect((await fetchContextView(settings, "hermes", "clean", "session")).context).toBeUndefined();
    expect((await uploadAttachment(settings, { uri: "unused", name: "test.txt", mime: "text/plain", blob: new Blob(["test"]) }, fetch)).name).toBe("test.txt");
    expect((await sendToPhone(settings, "/fixture/test.txt", fetch)).ok).toBe(true);
    await fetchContextView(settings, "hermes", "clean", "session", undefined, true);
    expect(minted).toBe(1);
    expect(secretKeys).toEqual(["dash.z0bridge.cred_0123456789abcdef"]);
    expect(calls.some(url => url.includes(credential) || url.includes(access))).toBe(false);
    clearIdentityTokens();
    await executionToken(settings); expect(minted).toBe(2);
  } finally { globalThis.fetch = original; clearIdentityTokens(); }
});

test("native constructor adapter passes the token in its third-argument headers, never the URL", async () => {
  const received: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request, server) {
    received.push(request.url, request.headers.get("authorization") ?? "");
    if (server.upgrade(request)) return;
    return new Response(null, { status: 400 });
  }, websocket: { open(ws) { ws.send("fixture"); }, message() {} } });
  let suppliedHeaders: Record<string, string> | undefined;
  const NativeAdapter = class extends WebSocket {
    constructor(url: string, protocols?: string[], options?: { headers: Record<string, string> }) {
      expect(protocols).toEqual([]);
      super(url, protocols);
      suppliedHeaders = options?.headers;
    }
  };
  const url = socketUrl({ address: `127.0.0.1:${server.port}`, token: "unused", identity: { url: "http://100.64.0.1:4788", kid: "k".repeat(43), issuer: "fixture", credentialId: "cred_0123456789abcdef" } });
  const ws = headerSocket(url, "short-lived-fixture", NativeAdapter);
  try {
    await new Promise<void>((resolve, reject) => { ws.onmessage = () => resolve(); ws.onerror = () => reject(new Error("fixture socket failed")); });
    expect(suppliedHeaders).toEqual({ Authorization: "Bearer short-lived-fixture" });
    expect(received[0]).toBe(`http://127.0.0.1:${server.port}/ws`);
  } finally { ws.close(); server.stop(true); }
});
