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
}

type Listener = { resolve(value: unknown): void; reject(error: Error): void };
interface Job { id: number; key: string; request: WorkerRequest; listeners: Set<Listener>; started: boolean; done: boolean; timer: ReturnType<typeof setTimeout> | undefined }

function isReply(value: unknown): value is WorkerReply {
  return typeof value === "object" && value !== null && ("id" in value || ("type" in value && value.type === "snapshot"));
}

/** One worker, one request at a time. Bounded queue, per-request deadline from enqueue. */
export class Lane {
  private readonly queue: Job[] = [];
  private active: Job | undefined;
  private readonly inflight = new Map<string, Job>();
  private seq = 0;
  onSnapshot: ((snapshot: Snapshot) => void) | undefined;

  constructor(private readonly worker: WorkerLike, private readonly timeoutMs = RPC_TIMEOUT_MS, private readonly cap = QUEUE_CAP) {
    worker.onmessage = event => this.receive(event.data);
  }

  /** Queued, not started. */
  get queued(): number { return this.queue.length; }

  call(op: WorkerOp, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(new AbortedError());
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
    if (this.active) return;
    const job = this.queue.shift();
    if (!job) return;
    job.started = true;
    this.active = job;
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
    this.active = undefined;
    const listeners = job.done ? [] : [...job.listeners];
    this.finish(job);
    for (const l of listeners) {
      if (ok) l.resolve(value);
      else l.reject(value instanceof Error ? value : new Error(String(value)));
    }
    this.pump();
  }

  terminate(): void {
    for (const job of [...this.queue, ...(this.active ? [this.active] : [])]) {
      const listeners = [...job.listeners];
      this.finish(job);
      for (const l of listeners) l.reject(new BusyError());
    }
    this.queue.length = 0;
    this.active = undefined;
    this.worker.terminate();
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
      const lane = new Lane(spawn(role), options.timeoutMs ?? RPC_TIMEOUT_MS);
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
