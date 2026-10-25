import { expect, spyOn, test } from "bun:test";
import type { Settings } from "../model";
import { fetchContextView } from "./context-api";

const settings: Settings = { address: "127.0.0.1:4747", token: "fixture-token", harness: "hermes", inAppFeedback: true };
const context = {
  sessionId: "session-1", model: "fixture-model", used: 24, maximum: 100, threshold: 80,
  estimated: false, source: "verified-fixture", categories: [], revision: "rev-1", notes: ["Existing context note"],
};
const plans = [{ provider: "fixture-provider", windows: [{ label: "daily", percent: 25 }] }];
const reading = { context, plans, compactionSupported: true };

async function withFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  check: () => Promise<void>,
): Promise<void> {
  const spy = spyOn(globalThis, "fetch").mockImplementation((input, init) => Promise.resolve(handler(String(input), init)));
  try { await check(); }
  finally { spy.mockRestore(); }
}

for (const status of [404, 501]) {
  test(`usage HTTP ${status} reads context and shows an informational unavailable notice without quota data`, async () => {
    const calls: { url: string; authorization: string | null; signal: AbortSignal | null | undefined }[] = [];
    const controller = new AbortController();
    await withFetch((url, init) => {
      calls.push({ url, authorization: new Headers(init?.headers).get("authorization"), signal: init?.signal });
      return new URL(url).pathname === "/chat/usage"
        ? new Response(null, { status })
        : Response.json(reading);
    }, async () => {
      const result = await fetchContextView(settings, "hermes", "profile 1", "session&1", controller.signal, true);
      expect(result.context).toEqual({ ...context, notes: [...context.notes, "usage unavailable on this bridge"] });
      expect(result.plans).toEqual([]);
      expect(result.compactionSupported).toBe(true);
    });
    expect(calls.map(call => new URL(call.url).pathname)).toEqual(["/chat/usage", "/chat/context"]);
    expect(calls.map(call => new URL(call.url).search)).toEqual([
      "?profile=profile%201&session=session%261&harness=hermes",
      "?profile=profile%201&session=session%261&harness=hermes",
    ]);
    expect(calls.map(call => call.authorization)).toEqual(["Bearer fixture-token", "Bearer fixture-token"]);
    expect(calls.map(call => call.signal)).toEqual([controller.signal, controller.signal]);
  });

  test(`usage HTTP ${status} with no context endpoint reports unavailable, not a generic error`, async () => {
    const requested: string[] = [];
    await withFetch(url => {
      requested.push(new URL(url).pathname);
      return new Response(null, { status });
    }, async () => {
      await expect(fetchContextView(settings, "hermes", "default", "session-1", undefined, true))
        .rejects.toThrow("usage unavailable on this bridge");
    });
    expect(requested).toEqual(["/chat/usage", "/chat/context"]);
  });
}

test("fallback without a real context snapshot does not invent context or plan usage", async () => {
  await withFetch(url => new URL(url).pathname === "/chat/usage"
    ? new Response(null, { status: 404 })
    : Response.json({ context: null, plans, compactionSupported: false }), async () => {
    await expect(fetchContextView(settings, "hermes", "default", "session-1", undefined, true))
      .rejects.toThrow("usage unavailable on this bridge");
  });
});

test("fallback with malformed JSON reports unavailable rather than a parsing error", async () => {
  await withFetch(url => new URL(url).pathname === "/chat/usage"
    ? new Response(null, { status: 501 })
    : new Response("{", { status: 200, headers: { "content-type": "application/json" } }), async () => {
    await expect(fetchContextView(settings, "hermes", "default", "session-1", undefined, true))
      .rejects.toThrow("usage unavailable on this bridge");
  });
});

test("supported usage reads valid plans and context without an unavailable notice or fallback", async () => {
  const paths: string[] = [];
  await withFetch(url => {
    paths.push(new URL(url).pathname);
    return Response.json(reading);
  }, async () => {
    expect(await fetchContextView(settings, "hermes", "default", "session-1", undefined, true))
      .toEqual(reading);
  });
  expect(paths).toEqual(["/chat/usage"]);
});

test("context-only reads never require the usage endpoint", async () => {
  const paths: string[] = [];
  await withFetch(url => {
    paths.push(new URL(url).pathname);
    return Response.json(reading);
  }, async () => {
    expect(await fetchContextView(settings, "hermes", "default", "session-1")).toEqual(reading);
  });
  expect(paths).toEqual(["/chat/context"]);
});

for (const [status, expected] of [
  [401, "Context access denied. Reconnect this computer."],
  [500, "Could not read context. Retry when connected."],
] as const) {
  test(`usage HTTP ${status} preserves real failures without falling back`, async () => {
    const paths: string[] = [];
    await withFetch(url => {
      paths.push(new URL(url).pathname);
      return new Response(null, { status });
    }, async () => {
      await expect(fetchContextView(settings, "hermes", "default", "session-1", undefined, true))
        .rejects.toThrow(expected);
    });
    expect(paths).toEqual(["/chat/usage"]);
  });
}
