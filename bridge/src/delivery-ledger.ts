import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { join } from "node:path";

/**
 * Durable, one-process bridge admission journal. Store a stable authenticated
 * principal ID, never an authorization token. Fingerprints must be SHA-256
 * digests, not raw messages or attachment contents.
 *
 * Call load() before accepting sends. A fulfilled reserve/update means the
 * replacement file AND its containing directory have been synced. A rejected
 * write never licenses execution; after an uncertain rename the instance
 * fails closed until load() reconciles the disk image.
 */
export const LEDGER_FILENAME = "delivery-ledger.v1.json";
export const LEDGER_VERSION = 1;
export const DEFAULT_LEDGER_MAX_BYTES = 4 * 1024 * 1024;
export const DEFAULT_LEDGER_MAX_ENTRIES = 8192;

export type DeliveryLedgerState =
  | "admitted"
  | "started"
  | "unknown"
  | "completed"
  | "failed"
  | "cancelled";

export type DeliveryLedgerReceipt = {
  type: "delivery_receipt";
  clientId: string;
  turnId: string;
  stage: "acked-by-bridge" | "started";
  at: number;
};

export interface DeliveryLedgerKey {
  principalId: string;
  clientId: string;
}

export interface DeliveryLedgerReservation extends DeliveryLedgerKey {
  /** Hex-encoded SHA-256 of the canonical immutable target/mode/payload. */
  fingerprint: string;
  turnId: string;
  at: number;
}

export interface DeliveryLedgerRecord extends DeliveryLedgerReservation {
  state: DeliveryLedgerState;
  admittedAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  receipt: DeliveryLedgerReceipt;
  /** An unknown or restart-surviving admission must be reconciled, never replay-started. */
  reconciliationRequired: boolean;
}

export interface DeliveryLedgerUpdate {
  state: DeliveryLedgerState;
  at: number;
  /** Set only after checking the actual host execution/terminal outcome. */
  reconciled?: boolean;
}

export interface DeliveryLedgerHandle {
  writeFile(contents: string): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface DeliveryLedgerFilesystem {
  mkdir(path: string): Promise<void>;
  readFile(path: string): Promise<string>;
  open(path: string, flags: "wx" | "r"): Promise<DeliveryLedgerHandle>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export const nodeDeliveryLedgerFilesystem: DeliveryLedgerFilesystem = {
  mkdir: async (path) => { await fs.mkdir(path, { recursive: true }); },
  readFile: (path) => fs.readFile(path, "utf8"),
  open: (path, flags) => fs.open(path, flags, 0o600),
  rename: (from, to) => fs.rename(from, to),
  unlink: (path) => fs.unlink(path),
};

export class DeliveryLedgerCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryLedgerCorruptError";
  }
}

export class DeliveryLedgerConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryLedgerConflictError";
  }
}

export class DeliveryLedgerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryLedgerUnavailableError";
  }
}

export class DeliveryLedgerCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryLedgerCapacityError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256
    && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
}

function validFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function validTime(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validState(value: unknown): value is DeliveryLedgerState {
  return value === "admitted" || value === "started" || value === "unknown"
    || value === "completed" || value === "failed" || value === "cancelled";
}

function terminal(state: DeliveryLedgerState): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

function keyOf(key: DeliveryLedgerKey): string {
  return JSON.stringify([key.principalId, key.clientId]);
}

function checkKey(key: DeliveryLedgerKey): void {
  if (!validId(key.principalId) || !validId(key.clientId)) {
    throw new TypeError("A stable principalId and clientId are required");
  }
}

function checkTime(at: number): void {
  if (!validTime(at)) throw new TypeError("Timestamp must be a nonnegative safe integer");
}

function copy(record: DeliveryLedgerRecord): DeliveryLedgerRecord {
  return { ...record, receipt: { ...record.receipt } };
}

const recordFields = new Set([
  "principalId", "clientId", "fingerprint", "turnId", "at",
  "state", "admittedAt", "updatedAt", "startedAt", "finishedAt",
  "receipt", "reconciliationRequired",
]);

const receiptFields = new Set(["type", "clientId", "turnId", "stage", "at"]);

function parseReceipt(value: unknown, clientId: string, turnId: string): DeliveryLedgerReceipt {
  if (!isObject(value) || Object.keys(value).length !== receiptFields.size
    || Object.keys(value).some((field) => !receiptFields.has(field))
    || value.type !== "delivery_receipt"
    || value.clientId !== clientId || value.turnId !== turnId
    || (value.stage !== "acked-by-bridge" && value.stage !== "started")
    || !validTime(value.at)) {
    throw new DeliveryLedgerCorruptError("Invalid persisted receipt");
  }
  return {
    type: "delivery_receipt", clientId, turnId,
    stage: value.stage, at: value.at,
  };
}

function parseRecord(value: unknown): DeliveryLedgerRecord {
  if (!isObject(value) || Object.keys(value).some((field) => !recordFields.has(field))
    || !validId(value.principalId) || !validId(value.clientId)
    || !validFingerprint(value.fingerprint) || !validId(value.turnId)
    || !validTime(value.at) || !validTime(value.admittedAt)
    || !validTime(value.updatedAt) || !validState(value.state)
    || typeof value.reconciliationRequired !== "boolean"
    || (value.startedAt !== undefined && !validTime(value.startedAt))
    || (value.finishedAt !== undefined && !validTime(value.finishedAt))) {
    throw new DeliveryLedgerCorruptError("Invalid persisted admission record");
  }
  const receipt = parseReceipt(value.receipt, value.clientId, value.turnId);
  if (value.at !== value.admittedAt || value.updatedAt < value.admittedAt
    || receipt.at < value.admittedAt || receipt.at > value.updatedAt
    || (value.startedAt !== undefined && (value.startedAt < value.admittedAt || value.startedAt > value.updatedAt))
    || (value.finishedAt !== undefined && (value.finishedAt < value.admittedAt || value.finishedAt > value.updatedAt))
    || (value.state === "admitted" && value.startedAt !== undefined)
    || (value.state === "started" && value.startedAt === undefined)
    || (receipt.stage === "started" && value.startedAt === undefined)
    || (terminal(value.state) !== (value.finishedAt !== undefined))) {
    throw new DeliveryLedgerCorruptError("Inconsistent persisted admission timestamps");
  }
  return {
    principalId: value.principalId, clientId: value.clientId,
    fingerprint: value.fingerprint, turnId: value.turnId, at: value.at,
    state: value.state, admittedAt: value.admittedAt, updatedAt: value.updatedAt,
    startedAt: typeof value.startedAt === "number" ? value.startedAt : undefined,
    finishedAt: typeof value.finishedAt === "number" ? value.finishedAt : undefined,
    receipt, reconciliationRequired: value.reconciliationRequired,
  };
}

function decodeSnapshot(contents: string, maxBytes: number, maxEntries: number): Map<string, DeliveryLedgerRecord> {
  if (Buffer.byteLength(contents, "utf8") > maxBytes) {
    throw new DeliveryLedgerCorruptError("Ledger exceeds configured recovery byte limit");
  }
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new DeliveryLedgerCorruptError("Truncated or invalid ledger JSON");
  }
  if (!isObject(value) || Object.keys(value).length !== 2
    || value.version !== LEDGER_VERSION || !Array.isArray(value.records)
    || value.records.length > maxEntries) {
    throw new DeliveryLedgerCorruptError("Unsupported version or invalid ledger record count");
  }
  const records = new Map<string, DeliveryLedgerRecord>();
  for (const raw of value.records) {
    const parsed = parseRecord(raw);
    const key = keyOf(parsed);
    if (records.has(key)) throw new DeliveryLedgerCorruptError("Duplicate principal/clientId in ledger");
    // Restart never implies permission to re-execute admitted or started work.
    records.set(key, {
      ...parsed,
      reconciliationRequired: terminal(parsed.state) ? false : true,
    });
  }
  return records;
}

function notFound(error: unknown): boolean {
  return isObject(error) && error.code === "ENOENT";
}

export class DeliveryLedger {
  readonly path: string;
  private readonly root: string;
  private readonly filesystem: DeliveryLedgerFilesystem;
  private readonly maxBytes: number;
  private readonly maxEntries: number;
  private records = new Map<string, DeliveryLedgerRecord>();
  private queue: Promise<void> = Promise.resolve();
  private loaded = false;
  private poisoned = false;

  constructor(options: {
    root: string;
    filesystem?: DeliveryLedgerFilesystem;
    maxBytes?: number;
    maxEntries?: number;
  }) {
    if (typeof options.root !== "string" || options.root.trim().length === 0) {
      throw new TypeError("Ledger root is required");
    }
    const maxBytes = options.maxBytes ?? DEFAULT_LEDGER_MAX_BYTES;
    const maxEntries = options.maxEntries ?? DEFAULT_LEDGER_MAX_ENTRIES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 256
      || !Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new TypeError("Ledger capacity bounds must be positive safe integers");
    }
    this.root = options.root;
    this.path = join(options.root, LEDGER_FILENAME);
    this.filesystem = options.filesystem ?? nodeDeliveryLedgerFilesystem;
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
  }

  private serialized<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.queue.then(action);
    // One failed disk operation must not deadlock the queue. An uncertain
    // rename poisons the instance separately until explicit recovery.
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private requireLoaded(): void {
    if (!this.loaded || this.poisoned) {
      throw new DeliveryLedgerUnavailableError("Ledger must load/reconcile before admissions");
    }
  }

  async load(): Promise<void> {
    return this.serialized(async () => {
      try {
        await this.filesystem.mkdir(this.root);
        let contents: string;
        try {
          contents = await this.filesystem.readFile(this.path);
        } catch (error) {
          if (!notFound(error)) throw error;
          if (this.records.size > 0) {
            throw new DeliveryLedgerCorruptError("Existing ledger vanished; refuse to clear unresolved records");
          }
          this.records = new Map();
          this.loaded = true;
          this.poisoned = false;
          return;
        }
        const next = decodeSnapshot(contents, this.maxBytes, this.maxEntries);
        this.records = next;
        this.loaded = true;
        this.poisoned = false;
      } catch (error) {
        this.poisoned = true;
        throw error;
      }
    });
  }

  async get(key: DeliveryLedgerKey): Promise<DeliveryLedgerRecord | undefined> {
    return this.serialized(async () => {
      this.requireLoaded();
      checkKey(key);
      const found = this.records.get(keyOf(key));
      return found ? copy(found) : undefined;
    });
  }

  async reserve(input: DeliveryLedgerReservation): Promise<DeliveryLedgerRecord> {
    return this.serialized(async () => {
      this.requireLoaded();
      checkKey(input);
      checkTime(input.at);
      if (!validFingerprint(input.fingerprint) || !validId(input.turnId)) {
        throw new TypeError("Reservation requires SHA-256 fingerprint and stable turnId");
      }
      const key = keyOf(input);
      const previous = this.records.get(key);
      if (previous) {
        if (previous.fingerprint !== input.fingerprint) {
          throw new DeliveryLedgerConflictError("Same principal/clientId has a different payload fingerprint");
        }
        return copy(previous); // Replays MUST use original turnId and receipt.
      }
      const record: DeliveryLedgerRecord = {
        ...input,
        admittedAt: input.at,
        updatedAt: input.at,
        state: "admitted",
        receipt: {
          type: "delivery_receipt", clientId: input.clientId,
          turnId: input.turnId, stage: "acked-by-bridge", at: input.at,
        },
        reconciliationRequired: false,
      };
      const next = new Map(this.records);
      next.set(key, record);
      await this.persist(next);
      this.records = next;
      return copy(record);
    });
  }

  async update(key: DeliveryLedgerKey, change: DeliveryLedgerUpdate): Promise<DeliveryLedgerRecord> {
    return this.serialized(async () => {
      this.requireLoaded();
      checkKey(key);
      checkTime(change.at);
      if (!validState(change.state)) throw new TypeError("Invalid ledger state");
      const encodedKey = keyOf(key);
      const previous = this.records.get(encodedKey);
      if (!previous) throw new DeliveryLedgerConflictError("Admission must be reserved before update");
      if (change.at < previous.updatedAt) {
        throw new DeliveryLedgerConflictError("Admission timestamps cannot go backwards");
      }
      if (terminal(previous.state) && previous.state !== change.state) {
        throw new DeliveryLedgerConflictError("Terminal admission cannot restart");
      }
      if ((previous.state === "started" || previous.state === "unknown") && change.state === "admitted") {
        throw new DeliveryLedgerConflictError("Admission state cannot regress");
      }
      if (previous.reconciliationRequired && change.state !== "unknown" && change.reconciled !== true) {
        if (change.state !== previous.state) {
          throw new DeliveryLedgerConflictError("Explicit host reconciliation required before transition");
        }
      }
      if (change.state === "started" && previous.state === "unknown" && change.reconciled !== true) {
        throw new DeliveryLedgerConflictError("Unknown execution cannot be presumed started");
      }
      const reconciliationRequired = change.state === "unknown"
        ? true
        : change.reconciled === true ? false : previous.reconciliationRequired;
      if (change.state === previous.state && reconciliationRequired === previous.reconciliationRequired) {
        return copy(previous);
      }
      const startedAt = change.state === "started" && previous.startedAt === undefined
        ? change.at : previous.startedAt;
      const record: DeliveryLedgerRecord = {
        ...previous,
        state: change.state,
        updatedAt: change.at,
        startedAt,
        finishedAt: terminal(change.state) ? change.at : undefined,
        receipt: change.state === "started"
          ? { type: "delivery_receipt", clientId: previous.clientId,
            turnId: previous.turnId, stage: "started", at: change.at }
          : previous.receipt,
        reconciliationRequired,
      };
      const next = new Map(this.records);
      next.set(encodedKey, record);
      await this.persist(next);
      this.records = next;
      return copy(record);
    });
  }

  /** Purge only terminal, old records. Unknown/admitted/started entries never age out. */
  async compact(terminalBefore: number): Promise<number> {
    return this.serialized(async () => {
      this.requireLoaded();
      checkTime(terminalBefore);
      const next = new Map(this.records);
      for (const [key, record] of next) {
        if (terminal(record.state) && record.updatedAt < terminalBefore) next.delete(key);
      }
      const removed = this.records.size - next.size;
      if (removed > 0) {
        await this.persist(next);
        this.records = next;
      }
      return removed;
    });
  }

  private async persist(next: Map<string, DeliveryLedgerRecord>): Promise<void> {
    if (next.size > this.maxEntries) throw new DeliveryLedgerCapacityError("Ledger entry limit reached");
    const body = JSON.stringify({ version: LEDGER_VERSION, records: [...next.values()] }) + "\n";
    if (Buffer.byteLength(body, "utf8") > this.maxBytes) {
      throw new DeliveryLedgerCapacityError("Ledger byte limit reached; compact terminal records first");
    }
    const temp = join(this.root, "." + LEDGER_FILENAME + "." + randomUUID() + ".tmp");
    let handle: DeliveryLedgerHandle | undefined;
    let renameAttempted = false;
    try {
      handle = await this.filesystem.open(temp, "wx");
      await handle.writeFile(body);
      await handle.sync();
      await handle.close();
      handle = undefined;
      renameAttempted = true;
      await this.filesystem.rename(temp, this.path);
      // Durable rename needs a directory fsync on POSIX, not only file fsync.
      const directory = await this.filesystem.open(this.root, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (error) {
      // A failed/uncertain rename or directory sync may have changed the
      // on-disk snapshot. Never issue another acknowledgement from stale RAM.
      if (renameAttempted) this.poisoned = true;
      if (handle) {
        try { await handle.close(); } catch { /* preserve original failure */ }
      }
      try { await this.filesystem.unlink(temp); } catch { /* harmless orphan temp */ }
      throw error;
    }
  }
}
