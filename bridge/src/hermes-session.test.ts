import { describe, expect, test } from "bun:test";
import { HARNESSES } from "./harnesses";
import {
  a2aBearerToken,
  agentCardUrl,
  parseHermesEnvFile,
  buildGatewayRequest,
  buildPeerRequest,
  gatewayOrigin,
  hermesCliArgv,
  jsonRpcEndpoint,
  runHermesSession,
} from "./hermes-session";

const hermes = HARNESSES.find((h) => h.id === "hermes");

describe("hermes CLI spawn (legacy)", () => {
  test("harness argv is still hermes chat -q", () => {
    expect(hermes).toBeDefined();
    expect(hermes?.bin).toBe("hermes");
    expect(hermes?.argv({ text: "list files", cwd: "/tmp/dash" })).toEqual([
      "chat",
      "-q",
      "list files",
      "-Q",
      "--in",
      "/tmp/dash",
    ]);
  });

  test("CLI fallback argv matches chat -q", () => {
    expect(hermesCliArgv({ text: "hi", cwd: "/work", sessionId: "abc" })).toEqual([
      "chat",
      "-q",
      "hi",
      "-Q",
      "--in",
      "/work",
      "--resume",
      "abc",
    ]);
  });
});

describe("hermes gateway request builder", () => {
  test("builds JSON-RPC SendMessage for a JSONRPC agent card", () => {
    const card = {
      url: "http://127.0.0.1:9900/",
      supportedInterfaces: [
        { url: "http://127.0.0.1:9900/", protocolBinding: "JSONRPC", protocolVersion: "1.0" },
      ],
    };
    const endpoint = jsonRpcEndpoint(card, "http://127.0.0.1:9900");
    expect(endpoint).toBe("http://127.0.0.1:9900/");
    const request = buildGatewayRequest({
      endpoint: endpoint ?? "http://127.0.0.1:9900/",
      text: "hello from dash",
      sessionId: "ctx-dash",
      token: "env-token",
      requestId: "1",
      messageId: "m1",
    });
    expect(request.method).toBe("POST");
    expect(request.url).toBe("http://127.0.0.1:9900/");
    expect(request.headers["Content-Type"]).toBe("application/json");
    expect(request.headers.Authorization).toBe("Bearer env-token");
    expect(request.body).toEqual({
      jsonrpc: "2.0",
      id: "1",
      method: "SendMessage",
      params: {
        message: {
          messageId: "m1",
          role: "ROLE_USER",
          parts: [{ text: "hello from dash" }],
          contextId: "ctx-dash",
        },
      },
    });
  });

  test("parses A2A keys from a hermes env file and ignores unrelated secrets", () => {
    const parsed = parseHermesEnvFile(
      "A2A_PUBLIC_URL=http://127.0.0.1:9900\nGROQ_API_KEY=nope\nA2A_MBP_TOKEN=from-file\nHERMES_PEER_GROOT_KEY=peer-file\n",
    );
    expect(parsed.A2A_PUBLIC_URL).toBe("http://127.0.0.1:9900");
    expect(parsed.A2A_MBP_TOKEN).toBe("from-file");
    expect(parsed.HERMES_PEER_GROOT_KEY).toBe("peer-file");
    expect(parsed.GROQ_API_KEY).toBeUndefined();
  });

  test("reads gateway origin and bearer from env, never hardcodes a token", () => {
    expect(gatewayOrigin({ A2A_PUBLIC_URL: "http://100.64.0.1:9900/" })).toBe("http://100.64.0.1:9900");
    expect(gatewayOrigin({ A2A_HOST: "100.64.0.1", A2A_PORT: "9900" })).toBe("http://100.64.0.1:9900");
    expect(agentCardUrl("http://100.64.0.1:9900")).toBe("http://100.64.0.1:9900/.well-known/agent.json");
    expect(a2aBearerToken({ A2A_MBP_TOKEN: "from-env" })).toBe("from-env");
    expect(a2aBearerToken({ A2A_PEER_TOKENS: "dash:peer-one,groot:peer-two" })).toBe("peer-one");
    expect(a2aBearerToken({})).toBeUndefined();
  });

  test("builds a hermes peer API chat request", () => {
    const request = buildPeerRequest({
      origin: "http://100.64.0.2:8642",
      sessionId: "sess-1",
      text: "ping peer",
      token: "peer-key",
    });
    expect(request.method).toBe("POST");
    expect(request.url).toBe("http://100.64.0.2:8642/api/sessions/sess-1/chat");
    expect(request.headers.Authorization).toBe("Bearer peer-key");
    expect(request.body).toEqual({ message: "ping peer" });
  });
});

describe("runHermesSession", () => {
  test("uses gateway JSON-RPC instead of spawning hermes chat -q", async () => {
    const calls: Array<{ url: string; method: string; jsonrpcMethod?: string }> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? "GET";
      let jsonrpcMethod: string | undefined;
      if (typeof init?.body === "string") {
        const parsed: unknown = JSON.parse(init.body);
        if (parsed && typeof parsed === "object" && "method" in parsed && typeof parsed.method === "string") {
          jsonrpcMethod = parsed.method;
        }
      }
      calls.push({ url, method, jsonrpcMethod });
      if (url.endsWith("/.well-known/agent.json")) {
        return Response.json({
          url: "http://gateway.test/",
          supportedInterfaces: [{ url: "http://gateway.test/", protocolBinding: "JSONRPC" }],
        });
      }
      return Response.json({
        jsonrpc: "2.0",
        id: "1",
        result: {
          message: {
            role: "ROLE_AGENT",
            parts: [{ text: "from gateway" }],
            contextId: "ctx-9",
          },
        },
      });
    };

    const paths: string[] = [];
    const result = await runHermesSession({
      input: { text: "hello", cwd: "/tmp" },
      env: { A2A_PUBLIC_URL: "http://gateway.test", A2A_BEARER_TOKEN: "secret-token" },
      fetch,
      log(event, fields) {
        if (event === "hermes.path" && typeof fields?.path === "string") paths.push(fields.path);
      },
    });

    expect(result.path).toBe("gateway");
    expect(result.path).not.toBe("cli");
    if (result.path === "gateway") {
      expect(result.text).toBe("from gateway");
      expect(result.sessionId).toBe("ctx-9");
    }
    expect(calls.some((c) => c.url.endsWith("/.well-known/agent.json"))).toBe(true);
    expect(calls.some((c) => c.jsonrpcMethod === "SendMessage")).toBe(true);
    expect(paths).toEqual(["gateway"]);
  });

  test("falls back to CLI when the gateway is down", async () => {
    const fetch: typeof globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const result = await runHermesSession({
      input: { text: "hello", cwd: "/tmp" },
      env: { A2A_PUBLIC_URL: "http://127.0.0.1:9" },
      fetch,
      log() {},
    });
    expect(result.path).toBe("cli");
    if (result.path === "cli") expect(result.reason).toBe("gateway_down");
  });

  test("uses peer API when the agent card is not JSONRPC", async () => {
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/.well-known/agent.json")) {
        return Response.json({
          url: "http://gateway.test/",
          supportedInterfaces: [{ url: "http://gateway.test/", protocolBinding: "GRPC" }],
        });
      }
      if (url.includes("/api/sessions/") && (init?.method ?? "GET") === "POST") {
        return Response.json({
          session_id: "sess-1",
          message: { content: "from peer" },
        });
      }
      return new Response("no", { status: 404 });
    };
    const result = await runHermesSession({
      input: { text: "hello", cwd: "/tmp", sessionId: "sess-1" },
      env: {
        A2A_PUBLIC_URL: "http://gateway.test",
        HERMES_PEER_URL: "http://peer.test:8642",
        HERMES_PEER_GROOT_KEY: "peer-secret",
      },
      fetch,
      log() {},
    });
    expect(result.path).toBe("peer");
    if (result.path === "peer") expect(result.text).toBe("from peer");
  });
});
