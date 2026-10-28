import { describe, expect, test } from "bun:test";
import type { IdentityEnrollment } from "./identity-client";
import {
  authorizedBridgeFetch,
  bridgeAuthHeaders,
  type BridgeRequestSettings,
} from "./bridge-request-auth";

const identity: IdentityEnrollment = {
  url: "https://identity.example.test",
  issuer: "identity.example.test",
  kid: "A".repeat(43),
  credentialId: "cred_0123456789abcdef",
};

describe("DF-105 bridge HTTP authorization", () => {
  test("identity enrollment uses its execution bearer even with an empty legacy token", async () => {
    const settings: BridgeRequestSettings = { token: "", identity };
    let received: BridgeRequestSettings | undefined;

    const result = await bridgeAuthHeaders(settings, {
      executionToken: async value => {
        received = value;
        return "  identity-access-token  ";
      },
    });

    expect(received).toBe(settings);
    expect(result).toEqual({
      ok: true,
      headers: { Authorization: "Bearer identity-access-token" },
    });
  });

  test("identity token rejection never falls back to a stored legacy token", async () => {
    const settings: BridgeRequestSettings = { token: "old-legacy-secret", identity };
    let calls = 0;
    const deps = {
      executionToken: async (_settings: BridgeRequestSettings): Promise<string> => {
        throw new Error("expired identity grant");
      },
      fetch: async (_url: string, _init?: RequestInit): Promise<Response> => {
        calls += 1;
        return new Response("unexpected");
      },
    };

    expect(await bridgeAuthHeaders(settings, deps)).toEqual({
      ok: false, reason: "identity-failed",
    });
    expect(await authorizedBridgeFetch(settings, "http://bridge.test/workers", {}, deps)).toEqual({
      ok: false, reason: "identity-failed",
    });
    expect(calls).toBe(0);
  });

  test("a blank identity execution token also fails closed, without a Bearer space", async () => {
    const settings = { token: "legacy", identity };
    const result = await bridgeAuthHeaders(settings, {
      executionToken: async () => "  \t ",
    });
    expect(result).toEqual({ ok: false, reason: "identity-failed" });
  });

  test("legacy bearer is trimmed and never asks for an identity execution token", async () => {
    let identityCalls = 0;
    const result = await bridgeAuthHeaders({ token: "  legacy-value \n" }, {
      executionToken: async () => {
        identityCalls += 1;
        return "wrong";
      },
    });
    expect(result).toEqual({
      ok: true, headers: { Authorization: "Bearer legacy-value" },
    });
    expect(identityCalls).toBe(0);
  });

  test("blank or whitespace-only legacy credentials prevent any fetch", async () => {
    let requests = 0;
    const fetcher = async (_url: string, _init?: RequestInit): Promise<Response> => {
      requests += 1;
      return new Response("must not be sent");
    };

    for (const token of ["", " ", "\t \n"]) {
      expect(await bridgeAuthHeaders({ token })).toEqual({
        ok: false, reason: "no-credential",
      });
      expect(await authorizedBridgeFetch(
        { token }, "http://bridge.test/suggestions", { method: "POST" }, { fetch: fetcher },
      )).toEqual({ ok: false, reason: "no-credential" });
    }
    expect(requests).toBe(0);
  });

  test("caller headers and request options survive, but Authorization is replaced", async () => {
    const originalHeaders = new Headers();
    originalHeaders.append("x-request-id", "trace-123");
    originalHeaders.append("Authorization", "Bearer old-one");
    originalHeaders.append("authorization", "Bearer old-two");
    const controller = new AbortController();
    const response = new Response("ok", { status: 202 });
    const requests: { url: string; init?: RequestInit }[] = [];

    const result = await authorizedBridgeFetch(
      { token: "", identity },
      "http://bridge.test/hermes/workers",
      { method: "POST", headers: originalHeaders, signal: controller.signal, body: "{}" },
      {
        executionToken: async () => "fresh-identity-token",
        fetch: async (url, init) => {
          requests.push({ url, init });
          return response;
        },
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.response).toBe(response);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://bridge.test/hermes/workers");
    expect(requests[0]?.init?.method).toBe("POST");
    expect(requests[0]?.init?.body).toBe("{}");
    expect(requests[0]?.init?.signal).toBe(controller.signal);
    const sentHeaders = new Headers(requests[0]?.init?.headers);
    expect(sentHeaders.get("x-request-id")).toBe("trace-123");
    expect(sentHeaders.get("authorization")).toBe("Bearer fresh-identity-token");
    expect([...sentHeaders.keys()].filter(key => key.toLowerCase() === "authorization")).toHaveLength(1);
    expect(originalHeaders.get("Authorization")).toBe("Bearer old-one, Bearer old-two");
  });

  test("plain object headers retain unrelated values and replace a case-insensitive bearer", async () => {
    let seen: Headers | undefined;
    const result = await authorizedBridgeFetch(
      { token: "  fallback-key  " },
      "http://bridge.test/chat/context",
      { headers: { "X-Caller": "preserved", authorization: "Bearer stale" } },
      {
        fetch: async (_url, init) => {
          seen = new Headers(init?.headers);
          return new Response("ok");
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(seen?.get("x-caller")).toBe("preserved");
    expect(seen?.get("authorization")).toBe("Bearer fallback-key");
  });

  test("network errors propagate instead of pretending an identity grant failed", async () => {
    const offline = new Error("connection refused");
    await expect(authorizedBridgeFetch(
      { token: "legacy" },
      "http://bridge.test/context",
      undefined,
      { fetch: async () => { throw offline; } },
    )).rejects.toBe(offline);
  });
});
