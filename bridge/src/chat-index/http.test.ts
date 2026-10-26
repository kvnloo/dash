import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { BridgeAuth } from "../z0bridge-identity";
import { AgentsviewFixture, engineConfig, inProcessWorker, TEST_RPC_TIMEOUT_MS, stalledWorker, tempDir } from "../fixtures/chat-index/make-fixtures";
import { AbortedError, BusyError, ChatIndexClient, Lane, Lru, STUCK_FACTOR, type WorkerLike } from "./client";
import { createChatsHttpHandler } from "./http";
import { parseChatSearchPage } from "../../../shared/protocol";
import type { WorkerRequest } from "./worker";

const TOKEN = "chat-index-test-token-never-log";
const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); });

function handlerWith(client: ChatIndexClient) {
  const auth = new BridgeAuth(TOKEN);
  return createChatsHttpHandler({
    authorize: async request => Boolean(await auth.authenticate(request, false)),
    client,
    self: () => ({ id: "0", name: "groot", matches: h => h === "0" }),
    live: () => [],
  });
}

describe("chats HTTP auth", () => {
  test("401 without the header and with only ?token=; 200 with the bearer header", async () => {
    const dir = tempDir();
    const av = new AgentsviewFixture(join(dir, "av.db"));
    av.session({ id: "codex:c1", agent: "codex" });
    const config = engineConfig(dir, { agentsviewPath: av.path });
    const client = new ChatIndexClient({ config, spawn: inProcessWorker(config), timeoutMs: TEST_RPC_TIMEOUT_MS });
    cleanup.push(() => client.stop());
    const handle = handlerWith(client);
    for (const path of ["/chats", "/chats/search?q=x", "/chats/history?key=0:codex:c1", "/chats/message?key=0:codex:c1&id=av:1"]) {
      expect((await handle(new Request(`http://b${path}`)))?.status).toBe(401);
      const sep = path.includes("?") ? "&" : "?";
      expect((await handle(new Request(`http://b${path}${sep}token=${TOKEN}`)))?.status).toBe(401);
    }
    const ok = await handle(new Request("http://b/chats", { headers: { Authorization: `Bearer ${TOKEN}` } }));
    expect(ok?.status).toBe(200);
    expect(await handle(new Request("http://b/other"))).toBeNull();
    expect((await handle(new Request("http://b/chats", { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` } })))?.status).toBe(405);
  });
});

describe("worker RPC", () => {
  test("503 busy with retryAfterMs when the worker is stalled past the timeout", async () => {
    const client = new ChatIndexClient({ config: engineConfig(tempDir()), spawn: () => stalledWorker(), timeoutMs: 60 });
    cleanup.push(() => client.stop());
    const res = await handlerWith(client)(new Request("http://b/chats", { headers: { Authorization: `Bearer ${TOKEN}` } }));
    expect(res?.status).toBe(503);
    expect(await res?.json()).toMatchObject({ ok: false, code: "busy", retryAfterMs: expect.any(Number) });
  });

  test("an aborted request that has not started is removed from the queue and never sent", async () => {
    const sent: WorkerRequest[] = [];
    const lane = new Lane(stalledWorker(sent), 5_000);
    cleanup.push(() => lane.terminate());
    void lane.call({ op: "snapshot", args: null }).catch(() => undefined); // occupies the worker
    const controller = new AbortController();
    const queued = lane.call({ op: "ingest", args: null }, controller.signal);
    expect(lane.queued).toBe(1);
    controller.abort();
    await expect(queued).rejects.toBeInstanceOf(AbortedError);
    expect(lane.queued).toBe(0);
    expect(sent.map(r => r.op)).toEqual(["snapshot"]);
  });

  test("queue cap returns busy; identical in-flight requests share one worker call", async () => {
    const sent: WorkerRequest[] = [];
    const lane = new Lane(stalledWorker(sent), 5_000, 3);
    cleanup.push(() => lane.terminate());
    void lane.call({ op: "snapshot", args: null }).catch(() => undefined);
    const a = lane.call({ op: "ingest", args: null }).catch(() => "a");
    const b = lane.call({ op: "ingest", args: null }).catch(() => "b");
    expect(lane.queued).toBe(1);
    void lane.call({ op: "message", args: { key: "k1", id: "1" } }).catch(() => undefined);
    void lane.call({ op: "message", args: { key: "k2", id: "1" } }).catch(() => undefined);
    await expect(lane.call({ op: "message", args: { key: "k3", id: "1" } })).rejects.toBeInstanceOf(BusyError);
    lane.terminate();
    expect(await a).toBe("a");
    expect(await b).toBe("b");
  });

  test("a late reply after a timeout is dropped and the lane frees", async () => {
    const sent: WorkerRequest[] = [];
    const worker: WorkerLike = { onmessage: null, postMessage(r: WorkerRequest) { sent.push(r); }, terminate() {} };
    const reply = (data: unknown) => worker.onmessage?.(new MessageEvent("message", { data }));
    const lane = new Lane(worker, 30);
    const first = lane.call({ op: "snapshot", args: null });
    await expect(first).rejects.toBeInstanceOf(BusyError);
    const second = lane.call({ op: "ingest", args: null });
    reply({ id: sent[0]?.id, ok: true, value: "late" });
    await Bun.sleep(0);
    expect(sent.map(r => r.op)).toEqual(["snapshot", "ingest"]);
    reply({ id: sent[1]?.id, ok: true, value: 7 });
    expect(await second).toBe(7);
  });
});

describe("lane recovery", () => {
  /** Answers init and every other op with `value`, and can be killed from the test. */
  function answering(log: string[], value: unknown) {
    const listeners: Record<string, (() => void)[]> = {};
    const worker: WorkerLike & { emit(type: "error" | "close"): void; terminated: boolean } = {
      onmessage: null,
      terminated: false,
      postMessage(r: WorkerRequest) {
        log.push(r.op);
        void Promise.resolve().then(() => worker.onmessage?.(new MessageEvent("message", { data: { id: r.id, ok: true, value: r.op === "init" ? true : value } })));
      },
      terminate() { worker.terminated = true; },
      addEventListener(type, listener) { (listeners[type] ??= []).push(listener); },
      emit(type) { for (const l of listeners[type] ?? []) l(); },
    };
    return worker;
  }

  test("a worker that never replies is replaced after STUCK_FACTOR x timeout; the next call is served", async () => {
    const sent: WorkerRequest[] = [];
    const log: string[] = [];
    const workers: WorkerLike[] = [];
    const lane = new Lane(() => { const w = workers.length === 0 ? stalledWorker(sent) : answering(log, "fresh"); workers.push(w); return w; }, 200);
    cleanup.push(() => lane.terminate());
    await lane.call({ op: "init", args: engineConfig(tempDir()) });
    const settled = (p: Promise<unknown>) => p.then(() => undefined, (error: unknown) => error);
    const hung = settled(lane.call({ op: "snapshot", args: null }));
    const queued = settled(lane.call({ op: "message", args: { key: "k", id: "1" } }));
    expect(await hung).toBeInstanceOf(BusyError);
    expect(await queued).toBeInstanceOf(BusyError);
    await Bun.sleep(200 * STUCK_FACTOR + 100);
    expect(lane.restarts).toBe(1);
    expect(await lane.call({ op: "snapshot", args: null })).toBe("fresh");
    expect(log).toEqual(["init", "snapshot"]);
  });

  test("a worker that errors or exits is replaced at once and re-initialised", async () => {
    const log: string[] = [];
    const workers: ReturnType<typeof answering>[] = [];
    const lane = new Lane(() => { const w = answering(log, workers.length); workers.push(w); return w; }, 5_000);
    cleanup.push(() => lane.terminate());
    await lane.call({ op: "init", args: engineConfig(tempDir()) });
    expect(await lane.call({ op: "snapshot", args: null })).toBe(0);
    workers[0]?.emit("error");
    expect(workers[0]?.terminated).toBe(true);
    expect(await lane.call({ op: "snapshot", args: null })).toBe(1);
    workers[1]?.emit("close");
    expect(await lane.call({ op: "snapshot", args: null })).toBe(2);
    expect(lane.restarts).toBe(2);
    expect(log).toEqual(["init", "snapshot", "init", "snapshot", "init", "snapshot"]);
    // A stale worker's events after replacement change nothing.
    workers[0]?.emit("close");
    expect(lane.restarts).toBe(2);
  });
});

describe("search degrades instead of failing", () => {
  test("a busy content scan still returns the title hits, partial, with a cursor that resumes the scan", async () => {
    const dir = tempDir();
    const av = new AgentsviewFixture(join(dir, "av.db"));
    av.session({ id: "codex:c1", agent: "codex", first_message: "flamingo plans" });
    const config = engineConfig(dir, { agentsviewPath: av.path });
    const healthy = inProcessWorker(config);
    // Worker 0 answers; worker 1 (content search) is stalled past the RPC timeout.
    const client = new ChatIndexClient({ config, spawn: role => (role === "search" ? stalledWorker() : healthy(role)), timeoutMs: 300 });
    cleanup.push(() => client.stop());
    await client.primary.call({ op: "ingest", args: null });
    const res = await handlerWith(client)(new Request("http://b/chats/search?q=flamingo", { headers: { Authorization: `Bearer ${TOKEN}` } }));
    expect(res?.status).toBe(200);
    const page = parseChatSearchPage(await res?.json());
    expect(page?.hits.map(h => h.field)).toEqual(["title"]);
    expect(page?.partial).toBe(true);
    expect(page?.next).not.toBeNull();
  });
});

describe("Lru", () => {
  test("evicts least recent, honors TTL, get refreshes recency", () => {
    let now = 0;
    const lru = new Lru<number>(2, 100, () => now);
    lru.set("a", 1); lru.set("b", 2);
    expect(lru.get("a")).toBe(1);
    lru.set("c", 3);
    expect(lru.get("b")).toBeUndefined();
    now = 150;
    expect(lru.get("a")).toBeUndefined();
  });
});
