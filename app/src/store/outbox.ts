import type { ChatAttachment } from "../../../shared/protocol";

/** Durable phone-side representation; transport acceptance is never a bridge acknowledgement. */
export type OutboxStage = "queued" | "sent" | "acked-by-bridge" | "started";
export type OutboxMode = "send" | "queue" | "steer";

export interface OutboxTarget {
  readonly harness: string;
  readonly mode: OutboxMode;
  readonly hostId?: string;
  readonly sessionId?: string;
  readonly profileId?: string;
  readonly cwd?: string;
}

export interface OutboxPayload {
  readonly text: string;
  readonly attachments?: readonly ChatAttachment[];
  readonly summariesEnabled?: boolean;
}

export interface NewOutboxMessage {
  readonly clientId: string;
  readonly turnId: string;
  readonly conversationId: string;
  readonly target: OutboxTarget;
  readonly payload: OutboxPayload;
}

export interface OutboxRecord extends NewOutboxMessage {
  readonly stage: OutboxStage;
  readonly attempts: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastAttemptAt?: number;
  readonly receiptAt?: number;
  readonly retryNeeded?: boolean;
  readonly error?: string;
}

/** Matches the additive delivery_receipt contract (#122), after authenticated socket parsing. */
export interface OutboxReceipt {
  readonly type: "delivery_receipt";
  readonly clientId: string;
  readonly turnId: string;
  readonly stage: "acked-by-bridge" | "started";
  readonly at: number;
}

/** A versioned storage adapter (#127) can implement this narrow interface. */
export interface OutboxPersistence {
  load(): Promise<readonly OutboxRecord[]>;
  save(records: readonly OutboxRecord[]): Promise<void>;
}

export interface OutboxTransport {
  /** true means only that the socket accepted the frame, not that the bridge admitted it. */
  send(record: OutboxRecord): boolean | Promise<boolean>;
}

export interface OutboxDependencies {
  readonly persistence: OutboxPersistence;
  readonly transport: OutboxTransport;
  readonly now?: () => number;
}

export type OutboxFailureReason =
  | "disposed" | "storage" | "invalid" | "duplicate" | "not-found"
  | "mismatch" | "confirmed" | "unsafe-retry" | "in-flight";

export type OutboxResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: OutboxFailureReason; readonly message: string };

export interface OutboxDispatch {
  readonly record: OutboxRecord;
  /** 'unconfirmed' includes a transport/write outcome we cannot establish durably. */
  readonly transport: "sent" | "not-sent" | "confirmed" | "unconfirmed" | "storage-blocked";
  readonly note?: string;
}

export interface OutboxStore {
  hydrate(): Promise<OutboxResult<readonly OutboxRecord[]>>;
  enqueue(message: NewOutboxMessage): Promise<OutboxResult<OutboxDispatch>>;
  receiveReceipt(receipt: OutboxReceipt): Promise<OutboxResult<OutboxRecord>>;
  retry(clientId: string, options: { readonly dedupeSupported: boolean }): Promise<OutboxResult<OutboxDispatch>>;
  disconnect(): Promise<OutboxResult<number>>;
  get(): readonly OutboxRecord[];
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value;
}

function timestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isTarget(value: unknown): value is OutboxTarget {
  return isObject(value) && identifier(value.harness)
    && (value.mode === "send" || value.mode === "queue" || value.mode === "steer")
    && optionalString(value.hostId) && optionalString(value.sessionId)
    && optionalString(value.profileId) && optionalString(value.cwd);
}

function isAttachment(value: unknown): value is ChatAttachment {
  return isObject(value) && identifier(value.id) && typeof value.name === "string"
    && typeof value.mime === "string" && timestamp(value.size);
}

function isPayload(value: unknown): value is OutboxPayload {
  return isObject(value) && typeof value.text === "string"
    && (value.summariesEnabled === undefined || typeof value.summariesEnabled === "boolean")
    && (value.attachments === undefined
      || (Array.isArray(value.attachments) && value.attachments.every(isAttachment)));
}

function isMessage(value: unknown): value is NewOutboxMessage {
  return isObject(value) && identifier(value.clientId) && identifier(value.turnId)
    && identifier(value.conversationId) && isTarget(value.target) && isPayload(value.payload);
}

function isStage(value: unknown): value is OutboxStage {
  return value === "queued" || value === "sent"
    || value === "acked-by-bridge" || value === "started";
}

function isRecord(value: unknown): value is OutboxRecord {
  return isMessage(value) && isObject(value)
    && isStage(value.stage) && typeof value.attempts === "number" && Number.isSafeInteger(value.attempts)
    && value.attempts >= 0 && timestamp(value.createdAt) && timestamp(value.updatedAt)
    && value.updatedAt >= value.createdAt
    && (value.lastAttemptAt === undefined || timestamp(value.lastAttemptAt))
    && (value.receiptAt === undefined || timestamp(value.receiptAt))
    && (value.retryNeeded === undefined || typeof value.retryNeeded === "boolean")
    && optionalString(value.error);
}

function immutable(record: OutboxRecord): OutboxRecord {
  const attachments = record.payload.attachments?.map(item => Object.freeze({
    id: item.id, name: item.name, mime: item.mime, size: item.size,
  }));
  const payload: OutboxPayload = Object.freeze({
    text: record.payload.text,
    ...(record.payload.summariesEnabled === undefined ? {} : { summariesEnabled: record.payload.summariesEnabled }),
    ...(attachments === undefined ? {} : { attachments: Object.freeze(attachments) }),
  });
  return Object.freeze({ ...record, target: Object.freeze({ ...record.target }), payload });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failed(reason: OutboxFailureReason, message: string): OutboxResult<never> {
  return { ok: false, reason, message };
}

function confirmed(stage: OutboxStage): boolean {
  return stage === "acked-by-bridge" || stage === "started";
}

/**
 * Serializes durable mutations, not network I/O. No send runs before the initial
 * queue record AND the attempt intent are saved. Later receipts cannot be overwritten
 * by a slow transport completion or an earlier pending storage operation.
 */
export function createOutboxStore(deps: OutboxDependencies): OutboxStore {
  let records: readonly OutboxRecord[] = Object.freeze([]);
  let hydrated = false;
  let loading: Promise<void> | undefined;
  let disposed = false;
  let writeTail: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const sending = new Set<string>();
  const now = deps.now ?? Date.now;

  function publish(next: readonly OutboxRecord[]): void {
    records = Object.freeze(next.map(immutable));
    if (disposed) return;
    for (const listener of listeners) {
      try { listener(); } catch { /* Subscriber errors cannot undo a durable write. */ }
    }
  }

  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const current = writeTail.then(operation);
    writeTail = current.then(() => undefined, () => undefined);
    return current;
  }

  function ensureHydrated(): Promise<void> {
    if (hydrated) return Promise.resolve();
    if (!loading) {
      loading = Promise.resolve().then(() => deps.persistence.load()).then(raw => {
        if (!Array.isArray(raw)) throw new Error("Outbox storage did not return an array.");
        const incoming: OutboxRecord[] = [];
        const clients = new Set<string>();
        const turns = new Set<string>();
        for (const candidate of raw) {
          if (!isRecord(candidate)) throw new Error("Outbox storage contains a malformed delivery record.");
          if (clients.has(candidate.clientId) || turns.has(candidate.turnId)) {
            throw new Error("Outbox storage contains duplicate delivery identities.");
          }
          clients.add(candidate.clientId);
          turns.add(candidate.turnId);
          incoming.push(immutable(candidate));
        }
        // Local records always win should a caller start hydration during a write.
        const local = new Set(records.map(item => item.clientId));
        const merged = [...incoming.filter(item => !local.has(item.clientId)), ...records];
        publish(merged);
        hydrated = true;
      }).catch(error => {
        loading = undefined; // Surface corruption; permit an explicit retry, never reset to [].
        throw error;
      });
    }
    return loading;
  }

  async function save(next: readonly OutboxRecord[]): Promise<void> {
    await deps.persistence.save(next);
    publish(next);
  }

  function lookup(clientId: string): OutboxRecord | undefined {
    return records.find(item => item.clientId === clientId);
  }

  async function attempt(clientId: string, dedupeSupported: boolean): Promise<OutboxResult<OutboxDispatch>> {
    if (disposed) return failed("disposed", "Outbox store is disposed.");
    if (sending.has(clientId)) return failed("in-flight", "A transport attempt is already in progress.");
    sending.add(clientId);
    try {
      const prepared = await exclusive(async (): Promise<OutboxResult<OutboxRecord>> => {
        if (disposed) return failed("disposed", "Outbox store is disposed.");
        try { await ensureHydrated(); } catch (error) {
          return failed("storage", `Could not hydrate outbox: ${errorText(error)}`);
        }
        if (disposed) return failed("disposed", "Outbox disposed while hydration was pending.");
        const record = lookup(clientId);
        if (!record) return failed("not-found", "Unknown clientId.");
        if (confirmed(record.stage)) return failed("confirmed", "Bridge has already acknowledged this turn; reconcile instead.");
        if (record.attempts > 0 && !dedupeSupported) {
          return failed("unsafe-retry", "Retry requires authenticated bridge idempotency support.");
        }
        const at = now();
        if (!timestamp(at)) return failed("invalid", "Clock returned an invalid timestamp.");
        const next = records.map(item => item.clientId === clientId
          ? immutable({ ...record, attempts: record.attempts + 1, updatedAt: Math.max(at, record.updatedAt), lastAttemptAt: at, retryNeeded: false, error: undefined })
          : item);
        try { await save(next); } catch (error) {
          return failed("storage", `Could not save send intent: ${errorText(error)}`);
        }
        const updated = lookup(clientId);
        return updated ? { ok: true, value: updated } : failed("not-found", "Outbox entry disappeared.");
      });
      if (!prepared.ok) return prepared;
      if (disposed) return failed("disposed", "Outbox disposed before transport; saved message remains queued.");

      let accepted = false;
      let uncertainTransport = false;
      let problem: string | undefined;
      try {
        accepted = (await deps.transport.send(prepared.value)) === true;
        if (!accepted) problem = "Transport did not accept the frame; bridge admission is unconfirmed.";
      } catch (error) {
        uncertainTransport = true;
        problem = `Transport outcome unconfirmed: ${errorText(error)}`;
      }
      return await exclusive(async (): Promise<OutboxResult<OutboxDispatch>> => {
        // Still persist the result after dispose; an in-flight frame may have escaped.
        const current = lookup(clientId);
        if (!current) return failed("not-found", "Outbox entry disappeared after transport.");
        if (confirmed(current.stage)) {
          return { ok: true, value: { record: current, transport: "confirmed" } };
        }
        const completedAt = now();
        const nextRecord = immutable({
          ...current,
          stage: accepted && current.stage === "queued" ? "sent" : current.stage,
          retryNeeded: !accepted,
          error: problem,
          updatedAt: timestamp(completedAt) ? Math.max(completedAt, current.updatedAt) : current.updatedAt,
        });
        const next = records.map(item => item.clientId === clientId ? nextRecord : item);
        try {
          await save(next);
        } catch (error) {
          return { ok: true, value: {
            record: current, transport: "unconfirmed",
            note: `Transport may have sent; write failed: ${errorText(error)}. Reconcile or use deduplicated retry.`,
          } };
        }
        const result = lookup(clientId) ?? nextRecord;
        return { ok: true, value: {
          record: result,
          transport: accepted ? "sent" : uncertainTransport || current.stage === "sent" ? "unconfirmed" : "not-sent",
          ...(problem ? { note: problem } : {}),
        } };
      });
    } finally {
      sending.delete(clientId);
    }
  }

  return {
    get: () => records,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      disposed = true;
      listeners.clear();
      sending.clear();
    },
    async hydrate() {
      if (disposed) return failed("disposed", "Outbox store is disposed.");
      try { await ensureHydrated(); } catch (error) {
        return failed("storage", `Could not hydrate outbox: ${errorText(error)}`);
      }
      if (disposed) return failed("disposed", "Outbox disposed while hydration was pending.");
      return { ok: true, value: records };
    },
    async enqueue(message) {
      const persisted = await exclusive(async (): Promise<OutboxResult<OutboxRecord>> => {
        if (disposed) return failed("disposed", "Outbox store is disposed.");
        try { await ensureHydrated(); } catch (error) {
          return failed("storage", `Could not hydrate outbox: ${errorText(error)}`);
        }
        if (disposed) return failed("disposed", "Outbox disposed while hydration was pending.");
        if (!isMessage(message)) return failed("invalid", "Missing or invalid delivery identity, target or payload.");
        if (records.some(item => item.clientId === message.clientId || item.turnId === message.turnId)) {
          return failed("duplicate", "clientId or turnId already belongs to an outbox entry.");
        }
        const at = now();
        if (!timestamp(at)) return failed("invalid", "Clock returned an invalid timestamp.");
        const entry = immutable({ ...message, stage: "queued", attempts: 0, createdAt: at, updatedAt: at });
        try { await save([...records, entry]); } catch (error) {
          return failed("storage", `Could not persist queued message: ${errorText(error)}. Keep caller draft.`);
        }
        return { ok: true, value: entry };
      });
      if (!persisted.ok) return persisted; // Caller may clear draft ONLY after this durable commit.
      const delivered = await attempt(persisted.value.clientId, false);
      if (delivered.ok) return delivered;
      if (delivered.reason === "confirmed") {
        return { ok: true, value: { record: lookup(persisted.value.clientId) ?? persisted.value, transport: "confirmed" } };
      }
      return { ok: true, value: {
        record: lookup(persisted.value.clientId) ?? persisted.value,
        transport: "storage-blocked",
        note: delivered.message, // The queue is durable even if dispatch could not begin.
      } };
    },
    retry(clientId, options) {
      return attempt(clientId, options.dedupeSupported);
    },
    receiveReceipt(receipt) {
      return exclusive(async (): Promise<OutboxResult<OutboxRecord>> => {
        if (disposed) return failed("disposed", "Outbox store is disposed.");
        try { await ensureHydrated(); } catch (error) {
          return failed("storage", `Could not hydrate outbox: ${errorText(error)}`);
        }
        if (disposed) return failed("disposed", "Outbox disposed while hydration was pending.");
        if (!identifier(receipt.clientId) || !identifier(receipt.turnId)
          || !timestamp(receipt.at) || receipt.type !== "delivery_receipt"
          || (receipt.stage !== "acked-by-bridge" && receipt.stage !== "started")) {
          return failed("invalid", "Invalid authenticated delivery receipt.");
        }
        const record = lookup(receipt.clientId);
        if (!record) return failed("not-found", "Unknown receipt clientId.");
        if (record.turnId !== receipt.turnId) return failed("mismatch", "Receipt turnId does not match the queued identity.");
        const rank = (stage: OutboxStage) =>
          stage === "queued" ? 0 : stage === "sent" ? 1 : stage === "acked-by-bridge" ? 2 : 3;
        if (rank(receipt.stage) <= rank(record.stage)) return { ok: true, value: record };
        const updated = immutable({
          ...record, stage: receipt.stage, receiptAt: receipt.at,
          updatedAt: Math.max(receipt.at, record.updatedAt), retryNeeded: false, error: undefined,
        });
        try {
          await save(records.map(item => item.clientId === receipt.clientId ? updated : item));
        } catch (error) {
          return failed("storage", `Could not persist receipt: ${errorText(error)}`);
        }
        return { ok: true, value: lookup(receipt.clientId) ?? updated };
      });
    },
    disconnect() {
      return exclusive(async (): Promise<OutboxResult<number>> => {
        if (disposed) return failed("disposed", "Outbox store is disposed.");
        try { await ensureHydrated(); } catch (error) {
          return failed("storage", `Could not hydrate outbox: ${errorText(error)}`);
        }
        if (disposed) return failed("disposed", "Outbox disposed while hydration was pending.");
        const affected = records.filter(item => !confirmed(item.stage)
          && (item.stage === "sent" || item.attempts > 0) && !item.retryNeeded);
        if (!affected.length) return { ok: true, value: 0 };
        const at = now();
        if (!timestamp(at)) return failed("invalid", "Clock returned an invalid timestamp.");
        const next = records.map(item => affected.includes(item)
          ? immutable({
            ...item, retryNeeded: true,
            error: "Connection dropped without a confirmed bridge receipt.",
            updatedAt: Math.max(item.updatedAt, at),
          })
          : item);
        try { await save(next); } catch (error) {
          return failed("storage", `Could not persist disconnected sends: ${errorText(error)}`);
        }
        return { ok: true, value: affected.length };
      });
    },
  };
}
