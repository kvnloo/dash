import { expect, test } from "bun:test";
import { fetchSessionWorkers, parseWorkers } from "./session-workers";

const worker = { id: "child", title: "Check tests", phase: "thinking", startedAt: 10, lastActivityAt: 20 };

test("workers parser rejects malformed rows and retains status-only metadata", () => {
  expect(parseWorkers(null)).toEqual([]);
  expect(parseWorkers({ workers: "not a list" })).toEqual([]);
  expect(parseWorkers({ workers: [null, {}, { id: "" }, worker] })).toEqual([worker]);
});

test("legacy worker polling authenticates, clears on completion and rejects unauthorized reads", async () => {
  const responses = [Response.json({ workers: [worker] }), Response.json({ workers: [] }), new Response(null, { status: 401 })];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    expect(request.headers.get("authorization")).toBe("Bearer legacy-fixture");
    expect(new URL(request.url).searchParams.get("session")).toBe("parent");
    return responses.shift() ?? new Response(null, { status: 500 });
  } });
  const settings = { address: `127.0.0.1:${server.port}`, token: "legacy-fixture", harness: "hermes", inAppFeedback: true };
  const signal = new AbortController().signal;
  try {
    expect(await fetchSessionWorkers(settings, "clean", "parent", signal)).toEqual([worker]);
    expect(await fetchSessionWorkers(settings, "clean", "parent", signal)).toEqual([]);
    await expect(fetchSessionWorkers(settings, "clean", "parent", signal)).rejects.toThrow("HTTP 401");
    const controller = new AbortController(); controller.abort();
    await expect(fetchSessionWorkers(settings, "clean", "parent", controller.signal)).rejects.toThrow();
  } finally { server.stop(true); }
});
