import { expect, test } from "bun:test";
import bundled from "./snapshot.json";
import { fetchTraceSnapshot, type TraceFetch } from "./feed";

test("feed sends bearer header only, validates wire shape and forwards cancellation", async () => {
  const controller = new AbortController();
  const fetcher: TraceFetch = async (input, init) => {
    expect(String(input)).toBe("http://127.0.0.1:4990/trace/snapshot");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer private-test-token");
    expect(init?.signal).toBe(controller.signal);
    return Response.json(bundled);
  };
  expect((await fetchTraceSnapshot({ address: "127.0.0.1:4990", token: " private-test-token " }, controller.signal, fetcher)).rows.length).toBeGreaterThan(0);
});
test("HTTP errors and invalid evidence fail closed rather than replacing current snapshot", async () => {
  const denied: TraceFetch = async () => new Response("no", { status: 401 });
  await expect(fetchTraceSnapshot({ address: "a", token: "b" }, undefined, denied)).rejects.toThrow("HTTP 401");
  const malformed: TraceFetch = async () => Response.json({ schema: "wrong" });
  await expect(fetchTraceSnapshot({ address: "a", token: "b" }, undefined, malformed)).rejects.toThrow("unknown schema");
});
