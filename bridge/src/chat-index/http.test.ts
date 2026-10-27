import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { BridgeAuth } from "../z0bridge-identity";
import { AgentsviewFixture, engineConfig, inProcessWorker, TEST_RPC_TIMEOUT_MS, stalledWorker, tempDir } from "../fixtures/chat-index/make-fixtures";
import { AbortedError, BusyError, ChatIndexClient, Lane, Lru, STUCK_FACTOR, type WorkerLike } from "./client";
import { createChatsHttpHandler } from "./http";
import { CURSOR_MAX_BYTES, encodeCursor, parseChatSearchPage } from "../../../shared/protocol";
import { EMITTED_MAX, msgCursor, readSearchCursor, withEmitted, type WorkerRequest } from "./worker";

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

describe("lane restart backoff", () => {
  /** A worker that dies as soon as it is attached (bad deploy, failed import, OOM on init). */
  function dying(spawned: { n: number }) {
    return (): WorkerLike => {
      spawned.n += 1;
      const listeners: (() => void)[] = [];
      setTimeout(() => { for (const l of listeners) l(); }, 0);
      return { onmessage: null, postMessage() {}, terminate() {}, addEventListener(type, listener) { if (type === "error") listeners.push(listener); } };
    };
  }

  test("a worker that dies at once is respawned with backoff, then the lane goes down and fails busy", async () => {
    const spawned = { n: 0 };
    const logs: string[] = [];
    const lane = new Lane(dying(spawned), 5_000, 64, { restart: { baseMs: 10, maxMs: 80, budget: 5, windowMs: 60_000 }, log: message => logs.push(message) });
    cleanup.push(() => lane.terminate());
    void lane.call({ op: "init", args: engineConfig(tempDir()) }).catch(() => undefined);
    await Bun.sleep(600);
    // Unbounded, this would be thousands of spawns. Restarts: 0, 10, 20, 40, 80 ms, then 80 ms apart while down.
    expect(spawned.n).toBeGreaterThanOrEqual(5);
    expect(spawned.n).toBeLessThanOrEqual(14);
    expect(logs.length).toBe(spawned.n);
    expect(logs.at(-1)).toContain("errored");
    const error = await lane.call({ op: "snapshot", args: null }).then(() => undefined, (e: unknown) => e);
    // Down: refused at once with the time left, or (between waits) queued and failed busy when the worker died.
    expect(error).toBeInstanceOf(BusyError);
    const settledAt = spawned.n;
    lane.terminate();
    await Bun.sleep(150);
    expect(spawned.n).toBe(settledAt);
  });

  test("while down, calls fail busy at once with retryAfterMs = the wait left", async () => {
    const spawned = { n: 0 };
    let now = 0;
    const lane = new Lane(dying(spawned), 5_000, 64, { restart: { baseMs: 1_000, maxMs: 30_000, budget: 1, windowMs: 60_000 }, now: () => now, log: () => {} });
    cleanup.push(() => lane.terminate());
    await Bun.sleep(20); // first death: immediate respawn (budget 1 used)
    await Bun.sleep(20); // second death: over budget, down for 1 s
    expect(spawned.n).toBe(2);
    now = 400;
    const error = await lane.call({ op: "snapshot", args: null }).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(BusyError);
    expect(error instanceof BusyError ? error.retryAfterMs : 0).toBe(600);
    expect(spawned.n).toBe(2);
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
    // The RPC timeout also bounds the healthy ingest and title query, so it must
    // outlast a loaded full suite; the stalled search worker still never replies.
    const client = new ChatIndexClient({ config, spawn: role => (role === "search" ? stalledWorker() : healthy(role)), timeoutMs: 5_000 });
    cleanup.push(() => client.stop());
    await client.primary.call({ op: "ingest", args: null });
    const res = await handlerWith(client)(new Request("http://b/chats/search?q=flamingo", { headers: { Authorization: `Bearer ${TOKEN}` } }));
    expect(res?.status).toBe(200);
    const page = parseChatSearchPage(await res?.json());
    expect(page?.hits.map(h => h.field)).toEqual(["title"]);
    expect(page?.partial).toBe(true);
    expect(page?.next).not.toBeNull();
  }, 20_000);
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

describe("search paging returns each chat once", () => {
  test("a chat with many matching messages, or a title hit, never repeats on later pages", async () => {
    const dir = tempDir();
    const av = new AgentsviewFixture(join(dir, "av.db"));
    const at = (m: number) => new Date(Date.UTC(2026, 0, 1, 0, m)).toISOString();
    av.db.transaction(() => {
      // "a": six matching messages, newest overall. "b": one older match. "t": matches by title too.
      av.session({ id: "codex:a", agent: "codex", ended_at: at(50) });
      for (let i = 0; i < 6; i++) av.message({ session_id: "codex:a", ordinal: i, role: "user", content: `needle ${i}`, timestamp: at(40 + i) });
      av.session({ id: "codex:b", agent: "codex", ended_at: at(10) });
      av.message({ session_id: "codex:b", ordinal: 0, role: "user", content: "needle b", timestamp: at(5) });
      av.session({ id: "codex:t", agent: "codex", first_message: "needle in the title", ended_at: at(30) });
      av.message({ session_id: "codex:t", ordinal: 0, role: "user", content: "needle again", timestamp: at(48) });
    })();
    const config = engineConfig(dir, { agentsviewPath: av.path });
    const client = new ChatIndexClient({ config, spawn: inProcessWorker(config), timeoutMs: TEST_RPC_TIMEOUT_MS });
    cleanup.push(() => client.stop());
    await client.primary.call({ op: "ingest", args: null });
    const handle = handlerWith(client);
    const keys: string[] = [];
    let cursor: string | null = "";
    let pages = 0;
    while (cursor !== null && pages < 20) {
      const res = await handle(new Request(`http://b/chats/search?q=needle&limit=1${cursor ? `&cursor=${cursor}` : ""}`, { headers: { Authorization: `Bearer ${TOKEN}` } }));
      expect(res?.status).toBe(200);
      const page = parseChatSearchPage(await res?.json());
      if (!page) throw new Error("bad page");
      keys.push(...page.hits.map(h => h.chat.sessionId));
      cursor = page.next;
      pages += 1;
    }
    expect(cursor).toBeNull();
    expect(keys.slice().sort()).toEqual(["a", "b", "t"]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("emitted-chat cursor field", () => {
  test("keeps the newest EMITTED_MAX hashes, round-trips, and rejects a malformed field", () => {
    const keys = Array.from({ length: EMITTED_MAX + 40 }, (_, i) => `0:codex:s${i}`);
    const emitted = withEmitted(withEmitted([], keys.slice(0, 100)), keys);
    expect(emitted).toHaveLength(EMITTED_MAX);
    expect(emitted.at(-1)).toBe(withEmitted([], [keys.at(-1) ?? ""])[0]);
    const cursor = msgCursor("abcd1234", { av: 9, hz: {} }, emitted);
    expect(cursor.length).toBeLessThanOrEqual(CURSOR_MAX_BYTES);
    expect(readSearchCursor(cursor, "abcd1234")?.emitted).toEqual(emitted);
    expect(() => readSearchCursor(encodeCursor({ v: 1, q: "abcd1234", ph: "msg", s: 1, x: "xyz" }), "abcd1234")).toThrow();
  });
});
