import { describe, expect, test } from "bun:test";
import {
  decodeGatewayReply,
  decodePeerReply,
  sameOriginGatewayEndpoint,
  verifyNativeHermesSession,
} from "./hermes-reply-guard";
import { buildGatewayRequest, runHermesSession, type HermesFetch } from "./hermes-session";

const gateway = "http://gateway.test";
const env = {
  A2A_PUBLIC_URL: gateway,
  HERMES_PEER_URL: "http://peer.test",
  DASH_HERMES_CLI_FALLBACK: "1",
};
const noFile = "/nonexistent/dash-hermes-reply-guard-test-env";

function agentResponse(text: string, contextId = "ctx-1"): unknown {
  return {
    jsonrpc: "2.0",
    id: "1",
    result: {
      message: { role: "ROLE_AGENT", contextId, parts: [{ text }] },
    },
  };
}

function mockGateway(reply: unknown, sends: string[], cards?: unknown): HermesFetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if ((init?.method ?? "GET") === "GET") {
      return Response.json(cards ?? {
        supportedInterfaces: [{ protocolBinding: "JSONRPC", url: gateway + "/" }],
      });
    }
    sends.push(url);
    return Response.json(reply);
  };
}

describe("Hermes JSON-RPC result contract", () => {
  test("accepts a correlated direct assistant result with its native context identity", () => {
    expect(decodeGatewayReply(agentResponse("answer"), "1")).toEqual({
      text: "answer", sessionId: "ctx-1",
    });
  });

  test("keeps distinct new conversations fresh and context-free", () => {
    const first = buildGatewayRequest({ endpoint: gateway + "/", text: "first" });
    const next = buildGatewayRequest({ endpoint: gateway + "/", text: "second" });
    expect(first.body.params.message.contextId).toBeUndefined();
    expect(next.body.params.message.contextId).toBeUndefined();
    expect(first.body.params.message.messageId).not.toBe(next.body.params.message.messageId);
  });

  test("HTTP 200 JSON-RPC error wins even if an apparent result is present", () => {
    expect(() => decodeGatewayReply({
      jsonrpc: "2.0", id: "1", error: { code: -32001, message: "unauthorized" },
      result: { message: { role: "ROLE_AGENT", parts: [{ text: "looks okay" }] } },
    }, "1")).toThrow("unauthorized");
  });

  test("requires an exact JSON-RPC version and response id", () => {
    expect(() => decodeGatewayReply({ jsonrpc: "1.0", id: "1", result: { text: "yes" } }, "1")).toThrow("envelope");
    expect(() => decodeGatewayReply({ jsonrpc: "2.0", id: "other", result: { text: "yes" } }, "1")).toThrow("uncorrelated");
    expect(() => decodeGatewayReply({ jsonrpc: "2.0", id: 1, result: { text: "yes" } }, "1")).toThrow("uncorrelated");
    expect(() => decodeGatewayReply({ jsonrpc: "2.0", id: "1", result: null }, "1")).toThrow("no JSON-RPC result");
  });

  test("never promotes a pending task status, status prose or user echo to a final answer", () => {
    expect(() => decodeGatewayReply({
      jsonrpc: "2.0", id: "1", result: {
        status: {
          state: "TASK_STATE_WORKING",
          message: { role: "ROLE_AGENT", parts: [{ text: "still generating" }] },
        },
      },
    }, "1")).toThrow("may still be running");
    expect(() => decodeGatewayReply({
      jsonrpc: "2.0", id: "1", result: {
        status: { state: "completed", message: { role: "ROLE_USER", parts: [{ text: "my prompt" }] } },
      },
    }, "1")).toThrow("no final agent reply");
    expect(() => decodeGatewayReply({
      jsonrpc: "2.0", id: "1", result: { status: { state: "completed", message: "completed" } },
    }, "1")).toThrow("no final agent reply");
  });

  test("rejects cancelled and failed task states without re-execution", () => {
    for (const state of ["TASK_STATE_FAILED", "canceled", "rejected"]) {
      expect(() => decodeGatewayReply({
        jsonrpc: "2.0", id: "1", result: {
          status: { state }, artifacts: [{ parts: [{ text: "partial" }] }],
        },
      }, "1")).toThrow("No fallback attempted");
    }
  });

  test("accepts a completed task artifact and prevents conversation crossover", () => {
    const result = {
      jsonrpc: "2.0", id: "1", result: {
        contextId: "ctx-7",
        status: { state: "TASK_STATE_COMPLETED" },
        artifacts: [{ parts: [{ text: "done" }] }],
      },
    };
    expect(decodeGatewayReply(result, "1", "ctx-7")).toEqual({ text: "done", sessionId: "ctx-7" });
    expect(() => decodeGatewayReply(result, "1", "ctx-8")).toThrow("different session identity");
  });

  test("does not accept two contradictory session identities in one response", () => {
    expect(() => decodeGatewayReply({
      jsonrpc: "2.0", id: "1", result: {
        contextId: "profile-a",
        message: { role: "ROLE_AGENT", contextId: "profile-b", parts: [{ text: "wrong" }] },
      },
    }, "1")).toThrow("conflicting session identities");
  });

  test("requires the configured gateway origin, with no credentials in agent-card URLs", () => {
    expect(sameOriginGatewayEndpoint(gateway + "/rpc", gateway)).toBe(gateway + "/rpc");
    expect(sameOriginGatewayEndpoint("/rpc", gateway)).toBe(gateway + "/rpc");
    for (const url of ["http://evil.test/rpc", "http://user:password@gateway.test/rpc", "file:///tmp/api", "http://gateway.test/rpc#secret"]) {
      expect(() => sameOriginGatewayEndpoint(url, gateway)).toThrow();
    }
  });
});

describe("Hermes native peer and profile isolation", () => {
  test("refuses wrong native session, cwd and profile", () => {
    const expected = { sessionId: "s-1", cwd: "/a", profileId: "profile-a" };
    expect(() => verifyNativeHermesSession({ session: { id: "s-2" } }, expected)).toThrow("profile/session");
    expect(() => verifyNativeHermesSession({ session: { id: "s-1", cwd: "/b" } }, expected)).toThrow("working directory");
    expect(() => verifyNativeHermesSession({ session: { id: "s-1", cwd: "/a", profile_id: "profile-b" } }, expected)).toThrow("different profile");
    expect(() => verifyNativeHermesSession({ session: { id: "s-1", cwd: "/a", profile_id: "profile-a" } }, expected)).not.toThrow();
  });

  test("never treats a peer queued receipt or user echo as a finished answer", () => {
    expect(() => decodePeerReply({ status: "queued", message: { content: "queued" } }, "s-1")).toThrow("may still be running");
    expect(() => decodePeerReply({ message: { role: "user", content: "my prompt" } }, "s-1")).toThrow("empty reply");
    expect(() => decodePeerReply({ error: { message: "not authorized" } }, "s-1")).toThrow("not authorized");
    expect(decodePeerReply({ session_id: "s-1", message: { content: "real answer" } }, "s-1")).toEqual({
      text: "real answer", sessionId: "s-1",
    });
  });

  test("enforces profile/cwd verification before native POST", async () => {
    for (const session of [
      { id: "s-1", cwd: "/other", profile_id: "p1" },
      { id: "s-1", cwd: "/work", profile_id: "p2" },
      { id: "not-mine", cwd: "/work", profile_id: "p1" },
    ]) {
      let posts = 0;
      const fetch: HermesFetch = async (_input, init) => {
        if (init?.method === "GET") return Response.json({ session });
        posts++;
        return Response.json({ message: { content: "must not happen" } });
      };
      await expect(runHermesSession({
        input: { text: "hello", cwd: "/work", sessionId: "s-1", profileId: "p1" },
        api: { url: "http://127.0.0.1:8642", key: "in-memory-test-key" },
        env: {}, envFile: noFile, fetch, log() {},
      })).rejects.toThrow();
      expect(posts).toBe(0);
    }
  });

  test("allows verified native session once and keeps exact identity", async () => {
    let posts = 0;
    const fetch: HermesFetch = async (_input, init) => {
      if (init?.method === "GET") return Response.json({ session: { id: "s-1", cwd: "/work", profile_id: "p1" } });
      posts++;
      expect(init?.redirect).toBe("error");
      return Response.json({ session_id: "s-1", message: { content: "from native" } });
    };
    const result = await runHermesSession({
      input: { text: "hello", cwd: "/work", sessionId: "s-1", profileId: "p1" },
      api: { url: "http://127.0.0.1:8642", key: "in-memory-test-key" },
      env: {}, envFile: noFile, fetch, log() {},
    });
    expect(posts).toBe(1);
    expect(result).toEqual({ path: "api", text: "from native", sessionId: "s-1" });
  });

  test("native identity HTTP 401 never admits a turn", async () => {
    let posts = 0;
    const fetch: HermesFetch = async (_input, init) => {
      if (init?.method === "GET") return new Response("denied", { status: 401 });
      posts++;
      return Response.json({ message: "should not send" });
    };
    await expect(runHermesSession({
      input: { text: "hello", cwd: "/work", sessionId: "s-1" },
      api: { url: "http://127.0.0.1:8642", key: "in-memory-test-key" },
      env: {}, envFile: noFile, fetch, log() {},
    })).rejects.toThrow("identity HTTP 401");
    expect(posts).toBe(0);
  });
});

describe("Hermes admission and no-fallback transport", () => {
  for (const invalid of [
    { label: "RPC error", payload: { jsonrpc: "2.0", id: "1", error: { code: -32603, message: "provider failed" } } },
    { label: "mismatched id", payload: { jsonrpc: "2.0", id: "other", result: { text: "stale" } } },
    { label: "nonterminal task", payload: { jsonrpc: "2.0", id: "1", result: { status: { state: "working" }, message: { role: "ROLE_AGENT", parts: [{ text: "partial" }] } } } },
    { label: "empty reply", payload: { jsonrpc: "2.0", id: "1", result: {} } },
    { label: "session crossover", payload: agentResponse("wrong", "ctx-b") },
  ]) {
    test("fails after one gateway send for " + invalid.label, async () => {
      const sends: string[] = [];
      await expect(runHermesSession({
        input: { text: "hello", cwd: "/work", sessionId: "ctx-a" },
        env, envFile: noFile, fetch: mockGateway(invalid.payload, sends), log() {},
      })).rejects.toThrow();
      expect(sends).toEqual([gateway + "/"]);
    });
  }

  test("a malicious discovery card cannot route credentials or the prompt off-host", async () => {
    const sends: string[] = [];
    await expect(runHermesSession({
      input: { text: "hello", cwd: "/work" },
      env: { ...env, A2A_BEARER_TOKEN: "not-logged-test-token" }, envFile: noFile,
      fetch: mockGateway(agentResponse("no"), sends, {
        supportedInterfaces: [{ protocolBinding: "JSONRPC", url: "http://evil.test/rpc" }],
      }), log() {},
    })).rejects.toThrow("No bearer token sent");
    expect(sends).toEqual([]);
  });

  test("transport failure after gateway POST never invokes the selected peer or CLI", async () => {
    const sends: string[] = [];
    const fetch: HermesFetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (init?.method !== "POST") return Response.json({ url: gateway + "/" });
      sends.push(url);
      throw new TypeError("connection reset after request write");
    };
    await expect(runHermesSession({ input: { text: "hello", cwd: "/work" }, env, envFile: noFile, fetch, log() {} })).rejects.toThrow();
    expect(sends).toEqual([gateway + "/"]);
  });

  test("pre-admission gateway downtime may select explicitly opted-in CLI", async () => {
    const fetch: HermesFetch = async () => { throw new TypeError("fetch failed"); };
    const result = await runHermesSession({
      input: { text: "hello", cwd: "/work" }, env, envFile: noFile, fetch, log() {},
    });
    expect(result.path).toBe("cli");
    if (result.path === "cli") expect(result.reason).toBe("gateway_down");
  });

  test("aborted discovery never reaches POST or CLI even with a fallback opt-in", async () => {
    const controller = new AbortController();
    const sends: string[] = [];
    const fetch: HermesFetch = async (_input, init) => {
      if (init?.method === "GET") {
        controller.abort();
        return Response.json({ url: gateway + "/" });
      }
      sends.push("send");
      return Response.json(agentResponse("late"));
    };
    await expect(runHermesSession({
      input: { text: "hello", cwd: "/work" }, env, envFile: noFile, fetch, signal: controller.signal, log() {},
    })).rejects.toThrow();
    expect(sends).toEqual([]);
  });

  test("native peer HTTP 202 remains an unconfirmed submission, never a CLI fallback", async () => {
    const sends: string[] = [];
    const fetch: HermesFetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (init?.method === "GET") {
        return Response.json({ supportedInterfaces: [{ protocolBinding: "GRPC", url: gateway + "/" }] });
      }
      sends.push(url);
      return new Response(null, { status: 202 });
    };
    await expect(runHermesSession({
      input: { text: "hello", cwd: "/work", sessionId: "s-1" },
      env, envFile: noFile, fetch, log() {},
    })).rejects.toThrow("accepted a queued turn");
    expect(sends).toEqual(["http://peer.test/api/sessions/s-1/chat"]);
  });
});
