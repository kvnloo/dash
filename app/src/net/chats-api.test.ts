import { describe, expect, test } from "bun:test";
import { createChatsApi, type ChatsApiDeps } from "./chats-api";

const settings = { address: "groot:4747", token: "secret" };
function fake(responses: { status: number; body?: unknown; headers?: Record<string, string> }[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const deps: ChatsApiDeps = {
    token: async () => "tok",
    fetch: async (url, init) => {
      calls.push({ url, headers: init.headers });
      if (init.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      const next = responses.shift() ?? { status: 500 };
      return { ok: next.status >= 200 && next.status < 300, status: next.status, headers: { get: (name: string) => next.headers?.[name] ?? null }, json: async () => next.body };
    },
  };
  return { api: createChatsApi(deps), calls };
}
const summary = { key: "k", kind: "codex", sessionId: "s", hostId: "groot", hostName: "groot", title: "t", startedAt: 1, lastActivityAt: 2, messageCount: 1, origin: "agentsview", chatable: true };

describe("chats api", () => {
  test("lists with header auth, filters and ETag; 304 is not modified", async () => {
    const { api, calls } = fake([{ status: 200, body: { items: [summary, { bad: true }], next: "n", rev: 3 }, headers: { ETag: "W/\"3-x\"", "X-Dash-Index": "building" } }, { status: 304 }]);
    const first = await api.list(settings, { kinds: ["codex", "omp"], cursor: "abc" });
    expect(first).toMatchObject({ ok: true, etag: "W/\"3-x\"", building: true });
    if (first.ok) expect(first.value.items).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://groot:4747/chats?limit=50&cursor=abc&kind=codex%2Comp");
    expect(calls[0]?.headers.Authorization).toBe("Bearer tok");
    expect(calls[0]?.url).not.toContain("token=");
    expect(await api.list(settings, {}, { etag: "W/\"3-x\"" })).toEqual({ ok: false, notModified: true });
    expect(calls[1]?.headers["If-None-Match"]).toBe("W/\"3-x\"");
  });
  test("errors carry the bridge code; an old bridge is a detectable 404; aborts are flagged", async () => {
    const { api } = fake([{ status: 503, body: { ok: false, code: "busy", retryAfterMs: 250 } }, { status: 404, body: "nope" }]);
    expect(await api.search(settings, { q: "deploy" })).toEqual({ ok: false, status: 503, code: "busy", retryAfterMs: 250 });
    expect(await api.history(settings, { key: "k" })).toEqual({ ok: false, status: 404, code: "not_found" });
    const controller = new AbortController(); controller.abort();
    expect(await api.search(settings, { q: "x" }, { signal: controller.signal })).toMatchObject({ ok: false, aborted: true });
  });
  test("history pages and full messages parse", async () => {
    const { api, calls } = fake([
      { status: 200, body: { messages: [{ id: "av:1", role: "user", text: "hi", at: 1, truncated: true }], before: "b" } },
      { status: 200, body: { message: { id: "av:1", role: "user", text: "hi there", at: 1 } } },
    ]);
    const page = await api.history(settings, { key: "groot:codex:s", before: "c", limit: 50 });
    expect(page.ok && page.value.before).toBe("b");
    expect(calls[0]?.url).toBe("http://groot:4747/chats/history?key=groot%3Acodex%3As&before=c&limit=50");
    const full = await api.message(settings, { key: "k", id: "av:1" });
    expect(full.ok && full.value.text).toBe("hi there");
  });
});
