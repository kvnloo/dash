import { describe, expect, test } from "bun:test";
import { createPairingSessions } from "../pair";
import { createPairingHttpHandler, MAX_PAIR_AUDIO_BYTES } from "./pairing-http";

function fixture(options: { limit?: number; audioCode?: string } = {}) {
  const pairing = createPairingSessions();
  let plays = 0;
  let decodes = 0;
  const handler = createPairingHttpHandler({
    bootstrapToken: "test-bootstrap-secret-never-log",
    token: "test-execution-secret-never-log",
    hostname: "test-host",
    address: "100.90.10.4:4747",
    cwd: "/workspace",
    harnesses: () => [],
    roster: () => [],
    pairing,
    playCode: () => { plays += 1; },
    decodeAudio: async () => { decodes += 1; return options.audioCode ?? null; },
    rateLimit: options.limit,
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request, server) {
      return await handler(request, server.requestIP(request)?.address ?? null) ?? new Response("not found", { status: 404 });
    },
  });
  const base = `http://127.0.0.1:${server.port}`;
  const request = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, init);
  const auth = { authorization: "Bearer test-bootstrap-secret-never-log", "content-type": "application/json" };
  return { handler, request, auth, pairing, stop: () => server.stop(true), played: () => plays, decoded: () => decodes };
}

describe("pairing HTTP trust boundary", () => {
  test("audio upload ceiling is exactly one MiB", () => {
    expect(MAX_PAIR_AUDIO_BYTES).toBe(1024 * 1024);
  });

  test("rejects malformed declared body lengths before reading valid JSON", async () => {
    const f = fixture();
    try {
      const response = await f.handler(new Request("http://localhost/pair/claim", {
        method: "POST", headers: { ...f.auth, "content-length": "not-a-number" }, body: '{"code":"AAAAAA"}',
      }), "127.0.0.1");
      expect(response?.status).toBe(413);
    } finally { f.stop(); }
  });

  test("every bootstrap/pair route rejects unauthenticated callers before effects", async () => {
    const f = fixture();
    try {
      for (const [path, method] of [["/", "GET"], ["/pair", "GET"], ["/pair/intent", "POST"], ["/pair/beep", "POST"], ["/pair/hear", "POST"], ["/pair/claim", "POST"]]) {
        const response = await f.request(path ?? "/", { method });
        expect(response.status).toBe(401);
        const body = await response.text();
        expect(body.includes("test-execution-secret")).toBe(false);
        expect(body.includes("test-bootstrap-secret")).toBe(false);
      }
      expect(f.played()).toBe(0);
      expect(f.decoded()).toBe(0);
    } finally { f.stop(); }
  });

  test("execution token cannot authorize pairing, and bootstrap token cannot authorize roster", async () => {
    const f = fixture();
    try {
      expect((await f.request("/pair", { headers: { authorization: "Bearer test-execution-secret-never-log" } })).status).toBe(401);
      expect((await f.request("/roster", { headers: f.auth })).status).toBe(401);
      expect((await f.request("/pair?token=test-bootstrap-secret-never-log")).status).toBe(401);
      expect((await f.request("/roster", { headers: { authorization: "Bearer test-execution-secret-never-log" } })).status).toBe(200);
    } finally { f.stop(); }
  });

  test("manual pairing needs bootstrap plus a valid one-use code", async () => {
    const f = fixture();
    try {
      const response = await f.request("/pair", { headers: f.auth });
      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || !("code" in body) || typeof body.code !== "string") throw new Error("missing code");
      expect(body.code.length).toBe(6);
      const claim = { method: "POST", headers: f.auth, body: JSON.stringify({ code: body.code }) };
      expect((await f.request("/pair/claim", { method: "POST", body: claim.body })).status).toBe(401);
      const claimed = await f.request("/pair/claim", claim);
      expect(claimed.status).toBe(200);
      const credentials: unknown = await claimed.json();
      expect(typeof credentials === "object" && credentials !== null && "token" in credentials && credentials.token === "test-execution-secret-never-log").toBe(true);
      expect((await f.request("/pair/claim", claim)).status).toBe(401);
    } finally { f.stop(); }
  });

  test("sonic sessions do not poison the manual fallback", async () => {
    const f = fixture();
    try {
      const key = new Uint8Array(32).fill(7);
      const bound = f.pairing.startBoundSession(key);
      const manual = f.pairing.currentOrCreateSession();
      expect(manual.id === bound.id).toBe(false);
      expect(f.pairing.claimSession(bound.code)).toBeNull();
      expect(f.pairing.claimSession(manual.code)?.id === manual.id).toBe(true);
      expect(f.pairing.claimSession(bound.code, key)?.id === bound.id).toBe(true);
    } finally { f.stop(); }
  });

  test("claim rate limits use the socket address despite spoofed forwarding headers", async () => {
    const f = fixture({ limit: 3 });
    try {
      for (let i = 0; i < 3; i += 1) {
        expect((await f.request("/pair/claim", { method: "POST", headers: { ...f.auth, "x-forwarded-for": `100.90.10.${i}` }, body: '{"code":"AAAAAA"}' })).status).toBe(401);
      }
      expect((await f.request("/pair/claim", { method: "POST", headers: { ...f.auth, "x-forwarded-for": "100.90.20.1" }, body: '{"code":"AAAAAA"}' })).status).toBe(429);
    } finally { f.stop(); }
  });

  test("auth failure attempts are also rate limited", async () => {
    const f = fixture({ limit: 2 });
    try {
      expect((await f.request("/pair")).status).toBe(401);
      expect((await f.request("/pair")).status).toBe(401);
      expect((await f.request("/pair")).status).toBe(429);
    } finally { f.stop(); }
  });

  test("rejects oversized JSON and audio before decoding", async () => {
    const f = fixture();
    try {
      expect((await f.request("/pair/claim", { method: "POST", headers: f.auth, body: JSON.stringify({ code: "A".repeat(17_000) }) })).status).toBe(413);
      expect((await f.request("/pair/hear", { method: "POST", headers: f.auth, body: JSON.stringify({ claimKey: Buffer.alloc(32, 7).toString("base64url"), audio: Buffer.alloc(MAX_PAIR_AUDIO_BYTES + 1).toString("base64") }) })).status).toBe(413);
      expect(f.decoded()).toBe(0);
    } finally { f.stop(); }
  });

  test("chunked requests cannot evade the body limit", async () => {
    const f = fixture();
    try {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"code":"'));
          controller.enqueue(new Uint8Array(17_000).fill(65));
          controller.enqueue(new TextEncoder().encode('"}'));
          controller.close();
        },
      });
      const response = await f.request("/pair/claim", { method: "POST", headers: f.auth, body });
      expect(response.status).toBe(413);
    } finally { f.stop(); }
  });

  test("missing transport identity fails closed", async () => {
    const f = fixture();
    try {
      const response = await f.handler(new Request("http://localhost/pair", { headers: f.auth }), null);
      expect(response?.status).toBe(403);
    } finally { f.stop(); }
  });

  test("authenticated audio claims require the phone-only key", async () => {
    const pairing = createPairingSessions();
    const key = new Uint8Array(32).fill(9);
    const session = pairing.startBoundSession(key);
    const handler = createPairingHttpHandler({
      bootstrapToken: "bootstrap-fixture-credential",
      token: "execution-fixture-credential",
      hostname: "fixture", address: "100.90.10.4:4747", cwd: "/workspace", harnesses: () => [], roster: () => [],
      pairing, playCode: () => {}, decodeAudio: async () => session.code,
    });
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request, server) {
      return await handler(request, server.requestIP(request)?.address ?? null) ?? new Response("not found", { status: 404 });
    } });
    try {
      const url = `http://127.0.0.1:${server.port}/pair/hear`;
      const headers = { authorization: "Bearer bootstrap-fixture-credential", "content-type": "application/json" };
      const audio = Buffer.from([1, 2, 3]).toString("base64");
      expect((await fetch(url, { method: "POST", headers, body: JSON.stringify({ audio, claimKey: Buffer.alloc(32, 8).toString("base64url") }) })).status).toBe(401);
      const response = await fetch(url, { method: "POST", headers, body: JSON.stringify({ audio, claimKey: Buffer.from(key).toString("base64url") }) });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body: unknown = await response.json();
      expect(typeof body === "object" && body !== null && "token" in body && body.token === "execution-fixture-credential").toBe(true);
      expect((await fetch(url, { method: "POST", headers, body: JSON.stringify({ audio, claimKey: Buffer.from(key).toString("base64url") }) })).status).toBe(401);
    } finally { server.stop(true); }
  });

  test("rejects malformed keys and audio without invoking audio workers", async () => {
    const f = fixture();
    try {
      expect((await f.request("/pair/intent", { method: "POST", headers: f.auth, body: JSON.stringify({ claimKey: `${Buffer.alloc(32, 7).toString("base64url")}!!` }) })).status).toBe(400);
      expect((await f.request("/pair/hear", { method: "POST", headers: f.auth, body: JSON.stringify({ claimKey: Buffer.alloc(32, 7).toString("base64url"), audio: "%%%" }) })).status).toBe(400);
      expect(f.played()).toBe(0);
      expect(f.decoded()).toBe(0);
    } finally { f.stop(); }
  });
});
