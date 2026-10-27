// Main-thread side of the chat index. Never touches a database: it queues RPCs to
// the workers (one lane each, so a slow content search never delays list/history),
// times them out, drops aborted ones that have not started, and shares identical
// in-flight requests. Snapshots from worker 0 feed the hello roster head.
import type { AgentInfo, HistoryMessage } from "../../../shared/protocol";
import { setArchiveHead } from "../agentsview-sessions";
import type {
  EngineConfig, HistoryArgs, ListArgs, ListValue, MsgArgs, MsgValue, Snapshot, TitleArgs, TitleValue, WorkerOp, WorkerReply, WorkerRequest, WsHistoryArgs,
} from "./worker";

export const RPC_TIMEOUT_MS = 2000;

type HistoryValue = { messages: HistoryMessage[]; before: string | null };
type Results = { list: ListValue; titleSearch: TitleValue; msgSearch: MsgValue; history: HistoryValue; wsHistory: HistoryValue; message: HistoryMessage };
export const QUEUE_CAP = 64;

// Reply shape checks (the engine builds these values; the checks keep the thread boundary typed without casts).
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCursor = (v: unknown) => v === null || typeof v === "string";
const isListValue = (v: unknown): v is ListValue => isObject(v) && Array.isArray(v.items) && isCursor(v.next) && typeof v.rev === "number" && typeof v.building === "boolean";
const isTitleValue = (v: unknown): v is TitleValue => isObject(v) && Array.isArray(v.hits) && Array.isArray(v.keys) && (v.next === null || isObject(v.next)) && typeof v.rev === "number";
const isMsgValue = (v: unknown): v is MsgValue => isObject(v) && Array.isArray(v.hits) && (v.next === null || isObject(v.next)) && typeof v.partial === "boolean" && typeof v.scanned === "number";
const isHistoryValue = (v: unknown): v is HistoryValue => isObject(v) && Array.isArray(v.messages) && isCursor(v.before);
const isMessage = (v: unknown): v is HistoryMessage => isObject(v) && typeof v.id === "string" && (v.role === "user" || v.role === "assistant") && typeof v.text === "string" && typeof v.at === "number";

export class BusyError extends Error {
  constructor(readonly retryAfterMs = 500) { super("busy"); }
}
export class RpcError extends Error {
  constructor(readonly code: string, readonly field?: string) { super(code); }
}
export class AbortedError extends Error {
  constructor() { super("aborted"); }
}

/** What client.ts needs from a Bun Worker. Tests inject fakes. */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  onmessage: ((event: MessageEvent) => void) | null;
  terminate(): void;
  /** A worker that dies ("error": uncaught error, failed import; "close": exited) is replaced. */
  addEventListener?(type: "error" | "close", listener: () => void): void;
}

/** A started job that has run this many lane timeouts is treated as a hung worker. */
export const STUCK_FACTOR = 3;

/**
 * Respawn policy. The first restart after a served job is immediate; each further one waits twice
 * as long (from `baseMs` up to `maxMs`). After `budget` restarts within `windowMs` the lane is down:
 * calls fail busy at once (retryAfterMs = the time left) and nothing spawns until the wait ends.
 * A served job resets the wait.
 */
export interface RestartPolicy { baseMs: number; maxMs: number; budget: number; windowMs: number }
export const RESTART_POLICY: RestartPolicy = { baseMs: 250, maxMs: 30_000, budget: 5, windowMs: 60_000 };
export interface LaneOptions {
  restart?: Partial<RestartPolicy>;
  now?: () => number;
  log?: (message: string) => void;
}

type Listener = { resolve(value: unknown): void; reject(error: Error): void };
interface Job { id: number; key: string; request: WorkerRequest; listeners: Set<Listener>; started: boolean; done: boolean; timer: ReturnType<typeof setTimeout> | undefined }

function isReply(value: unknown): value is WorkerReply {
  return typeof value === "object" && value !== null && ("id" in value || ("type" in value && value.type === "snapshot"));
}

/**
 * One worker, one request at a time. Bounded queue, per-request deadline from enqueue.
 * Given a spawn function, the lane is self-healing: when its worker errors, exits, or holds one job
 * for STUCK_FACTOR x timeoutMs (a stalled read on the archive mount), every pending call fails busy,
 * the worker is terminated, and a fresh one is spawned and re-sent the last init op.
 */
export class Lane {
  private readonly queue: Job[] = [];
  private active: Job | undefined;
  private readonly inflight = new Map<string, Job>();
  private seq = 0;
  /** Undefined while a replacement waits out its backoff. */
  private worker: WorkerLike | undefined;
  private readonly spawn: (() => WorkerLike) | undefined;
  private readonly policy: RestartPolicy;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  /** Wait before the next respawn (0: immediate); doubles per restart, reset by a served job. */
  private backoffMs = 0;
  private readonly restartTimes: number[] = [];
  private respawnTimer: ReturnType<typeof setTimeout> | undefined;
  /** While set and in the future, the lane spent its restart budget: calls fail busy at once. */
  private downUntil = 0;
  private initOp: Extract<WorkerOp, { op: "init" }> | undefined;
  private generation = 0;
  private stuck: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  /** Times the lane replaced its worker. */
  restarts = 0;
  onSnapshot: ((snapshot: Snapshot) => void) | undefined;

  constructor(source: WorkerLike | (() => WorkerLike), private readonly timeoutMs = RPC_TIMEOUT_MS, private readonly cap = QUEUE_CAP, options: LaneOptions = {}) {
    this.spawn = typeof source === "function" ? source : undefined;
    this.policy = { ...RESTART_POLICY, ...options.restart };
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (message => console.warn(message));
    this.worker = this.attach(typeof source === "function" ? source() : source);
  }

  private attach(worker: WorkerLike): WorkerLike {
    const generation = ++this.generation;
    worker.onmessage = event => { if (generation === this.generation) this.receive(event.data); };
    worker.addEventListener?.("error", () => this.died(generation, "errored"));
    worker.addEventListener?.("close", () => this.died(generation, "exited"));
    return worker;
  }

  private died(generation: number, reason: string): void {
    if (generation === this.generation && !this.closed) this.recover(reason);
  }

  /**
   * Fail everything pending, drop the worker, and schedule a replacement under the restart policy
   * (re-sent the last init op). Without a spawn function, only fails the pending jobs.
   */
  private recover(reason: string): void {
    if (this.stuck) clearTimeout(this.stuck);
    this.stuck = undefined;
    const victims = [...(this.active ? [this.active] : []), ...this.queue];
    this.queue.length = 0;
    this.active = undefined;
    for (const job of victims) {
      const listeners = job.done ? [] : [...job.listeners];
      this.finish(job);
      for (const l of listeners) l.reject(new BusyError(this.retryAfter()));
    }
    if (!this.spawn) return;
    const old = this.worker;
    this.worker = undefined;
    this.generation++; // the old worker's late replies and close event are ignored
    try { old?.terminate(); } catch { /* already gone */ }
    if (this.respawnTimer) return; // a replacement is already scheduled
    const now = this.now();
    while (this.restartTimes.length && now - (this.restartTimes[0] ?? 0) > this.policy.windowMs) this.restartTimes.shift();
    const wait = this.backoffMs;
    this.backoffMs = Math.min(this.policy.maxMs, Math.max(this.policy.baseMs, wait * 2));
    // Out of budget: down for at least one full backoff step, so a crash loop spawns at most once per wait.
    const delay = this.restartTimes.length >= this.policy.budget ? Math.max(wait, this.policy.baseMs) : wait;
    if (this.restartTimes.length >= this.policy.budget) this.downUntil = now + delay;
    this.log(`[chat-index] worker ${reason}; restart ${this.restarts + 1} in ${delay} ms${this.downUntil > now ? " (restart budget spent: lane down)" : ""}`);
    if (delay === 0) this.respawn();
    else this.respawnTimer = setTimeout(() => { this.respawnTimer = undefined; this.respawn(); }, delay);
  }

  private respawn(): void {
    if (this.closed || !this.spawn) return;
    this.downUntil = 0;
    this.restartTimes.push(this.now());
    this.restarts++;
    let worker: WorkerLike;
    try { worker = this.spawn(); } catch (error) {
      this.recover(`failed to spawn (${error instanceof Error ? error.message : String(error)})`);
      return;
    }
    this.worker = this.attach(worker);
    if (this.initOp) void this.call(this.initOp).catch(() => undefined);
    this.pump();
  }

  /** Time until a down lane spawns again (0 when it is up). */
  private retryAfter(): number {
    return Math.max(0, this.downUntil - this.now());
  }

  /** Queued, not started. */
  get queued(): number { return this.queue.length; }

  call(op: WorkerOp, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(new AbortedError());
    if (op.op === "init") this.initOp = op;
    const down = this.retryAfter();
    if (down > 0) return Promise.reject(new BusyError(down));
    const key = JSON.stringify(op);
    let job = op.op === "init" || op.op === "stall" ? undefined : this.inflight.get(key);
    if (!job) {
      if (this.queue.length >= this.cap) return Promise.reject(new BusyError());
      const id = ++this.seq;
      const created: Job = { id, key, request: { ...op, id }, listeners: new Set(), started: false, done: false, timer: undefined };
      created.timer = setTimeout(() => this.expire(created), this.timeoutMs);
      this.inflight.set(key, created);
      this.queue.push(created);
      job = created;
    }
    const target = job;
    return new Promise<unknown>((resolve, reject) => {
      const listener: Listener = { resolve, reject };
      target.listeners.add(listener);
      signal?.addEventListener("abort", () => {
        if (!target.listeners.delete(listener)) return;
        reject(new AbortedError());
        if (target.listeners.size === 0 && !target.started) this.drop(target);
      }, { once: true });
      this.pump();
    });
  }

  private drop(job: Job): void {
    const at = this.queue.indexOf(job);
    if (at >= 0) this.queue.splice(at, 1);
    this.finish(job);
  }

  private finish(job: Job): void {
    job.done = true;
    if (job.timer) clearTimeout(job.timer);
    if (this.inflight.get(job.key) === job) this.inflight.delete(job.key);
  }

  private expire(job: Job): void {
    if (job.done) return;
    const listeners = [...job.listeners];
    job.listeners.clear();
    if (!job.started) this.drop(job);
    else this.finish(job); // the worker's late reply is dropped; the lane frees when it arrives
    for (const l of listeners) l.reject(new BusyError());
  }

  private pump(): void {
    if (this.active || !this.worker) return;
    const job = this.queue.shift();
    if (!job) return;
    job.started = true;
    this.active = job;
    if (this.spawn) this.stuck = setTimeout(() => { if (this.active === job) this.recover("stuck"); }, this.timeoutMs * STUCK_FACTOR);
    try { this.worker.postMessage(job.request); } catch { this.settle(job, false, new BusyError()); }
  }

  private receive(data: unknown): void {
    if (!isReply(data)) return;
    if ("type" in data) { this.onSnapshot?.(data.snapshot); return; }
    const job = this.active;
    if (!job || job.id !== data.id) return;
    if (data.ok) this.settle(job, true, data.value);
    else this.settle(job, false, data.code === "busy" ? new BusyError() : new RpcError(data.code, data.field));
  }

  private settle(job: Job, ok: boolean, value: unknown): void {
    if (this.stuck) clearTimeout(this.stuck);
    this.stuck = undefined;
    this.active = undefined;
    // A served job (even an error reply) proves the worker works: the next restart is immediate.
    // Init does not count: a worker that inits and then dies on its first real job keeps backing off.
    if ((ok || value instanceof RpcError) && job.request.op !== "init") this.backoffMs = 0;
    const listeners = job.done ? [] : [...job.listeners];
    this.finish(job);
    for (const l of listeners) {
      if (ok) l.resolve(value);
      else l.reject(value instanceof Error ? value : new Error(String(value)));
    }
    this.pump();
  }

  terminate(): void {
    this.closed = true;
    if (this.stuck) clearTimeout(this.stuck);
    this.stuck = undefined;
    for (const job of [...this.queue, ...(this.active ? [this.active] : [])]) {
      const listeners = [...job.listeners];
      this.finish(job);
      for (const l of listeners) l.reject(new BusyError());
    }
    this.queue.length = 0;
    this.active = undefined;
    if (this.respawnTimer) clearTimeout(this.respawnTimer);
    this.respawnTimer = undefined;
    this.worker?.terminate();
  }
}

/** Map-based LRU with TTL. */
export class Lru<V> {
  private readonly map = new Map<string, { value: V; at: number }>();
  constructor(private readonly max: number, private readonly ttlMs: number, private readonly now: () => number = Date.now) {}
  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at > this.ttlMs) { this.map.delete(key); return undefined; }
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }
  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, at: this.now() });
    while (this.map.size > this.max) { const oldest = this.map.keys().next().value; if (oldest === undefined) break; this.map.delete(oldest); }
  }
  clear(): void { this.map.clear(); }
}

export interface ClientOptions {
  config: Omit<EngineConfig, "role">;
  /** DASH_CHAT_WORKERS: 1 shares one worker for everything; 2 (default) isolates content search. */
  workers?: number;
  spawn?: (role: EngineConfig["role"]) => WorkerLike;
  timeoutMs?: number;
}

function spawnWorker(): WorkerLike {
  const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
  worker.unref();
  return worker;
}

export class ChatIndexClient {
  readonly primary: Lane;
  readonly search: Lane;
  private snap: Snapshot = { rev: 0, head: [], building: true };
  readonly searchCache = new Lru<unknown>(64, 30_000);

  constructor(options: ClientOptions) {
    const spawn = options.spawn ?? spawnWorker;
    const make = (role: EngineConfig["role"]) => {
      const lane = new Lane(() => spawn(role), options.timeoutMs ?? RPC_TIMEOUT_MS);
      void lane.call({ op: "init", args: { ...options.config, role } }).catch(() => undefined);
      return lane;
    };
    this.primary = make("primary");
    this.search = (options.workers ?? 2) >= 2 ? make("search") : this.primary;
    this.primary.onSnapshot = snapshot => this.accept(snapshot);
  }

  private accept(snapshot: Snapshot): void {
    if (snapshot.rev !== this.snap.rev) this.searchCache.clear();
    this.snap = snapshot;
    setArchiveHead(snapshot.head);
  }

  /** Cached, synchronous, never blocks: the AgentsView head for the hello roster. */
  rosterHead(): AgentInfo[] { return this.snap.head; }
  get rev(): number { return this.snap.rev; }
  get building(): boolean { return this.snap.building; }

  /** A worker reply is a structured clone from another thread: checked against its op's shape before use. */
  private async rpc<K extends keyof Results>(lane: Lane, op: Extract<WorkerOp, { op: K }>, guard: (value: unknown) => value is Results[K], signal?: AbortSignal): Promise<Results[K]> {
    const value: unknown = await lane.call(op, signal);
    if (!guard(value)) throw new RpcError("internal");
    return value;
  }

  list(args: ListArgs, signal?: AbortSignal): Promise<ListValue> { return this.rpc(this.primary, { op: "list", args }, isListValue, signal); }
  titleSearch(args: TitleArgs, signal?: AbortSignal): Promise<TitleValue> { return this.rpc(this.primary, { op: "titleSearch", args }, isTitleValue, signal); }
  msgSearch(args: MsgArgs, signal?: AbortSignal): Promise<MsgValue> { return this.rpc(this.search, { op: "msgSearch", args }, isMsgValue, signal); }
  history(args: HistoryArgs, signal?: AbortSignal): Promise<HistoryValue> { return this.rpc(this.primary, { op: "history", args }, isHistoryValue, signal); }
  wsHistory(args: WsHistoryArgs): Promise<HistoryValue> { return this.rpc(this.primary, { op: "wsHistory", args }, isHistoryValue); }
  message(args: { key: string; id: string }, signal?: AbortSignal): Promise<HistoryMessage> { return this.rpc(this.primary, { op: "message", args }, isMessage, signal); }

  stop(): void {
    this.primary.terminate();
    if (this.search !== this.primary) this.search.terminate();
  }
}
