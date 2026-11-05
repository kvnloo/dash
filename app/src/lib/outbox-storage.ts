import {
  MAX_ATTACHMENTS_PER_TURN,
  parseChatAttachments,
  type ChatAttachment,
} from "../../../shared/protocol";

/**
 * A separate, eagerly awaited journal. Never reuse the debounced composer-draft
 * or conversation snapshots as proof of bridge admission.
 */
export const OUTBOX_STORAGE_KEY = "dash.outbox.v1";

export type OutboxStage = "queued" | "sent" | "acked-by-bridge" | "started";
export type OutboxMode = "send" | "steer" | "queue";

export interface OutboxTarget {
  harness: string;
  hostId?: string;
  profileId?: string;
  sessionId?: string;
  cwd?: string;
}

/** Device URIs are only recovery hints after restart, never valid uploaded ids. */
export interface OutboxLocalFile {
  uri: string;
  name: string;
  mime: string;
  size?: number;
}

export interface OutboxPayload {
  text: string;
  /** Bridge-issued attachment ids survive a process restart unchanged. */
  attachments?: ChatAttachment[];
  /** These require re-selection and upload before any replay. */
  localFiles?: OutboxLocalFile[];
  summariesEnabled?: boolean;
}

export interface OutboxRecord {
  clientId: string;
  turnId: string;
  conversationId: string;
  target: OutboxTarget;
  mode: OutboxMode;
  payload: OutboxPayload;
  stage: OutboxStage;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  lastSentAt?: number;
  ackedAt?: number;
  startedAt?: number;
  retryNeeded?: boolean;
  error?: string;
}

export interface OutboxRecoveryProblem {
  kind: "local-file-reselect";
  clientId: string;
  turnId: string;
  fileName: string;
  message: string;
}

export interface OutboxSnapshot {
  /** Monotonically increasing, required for a compare-before-write save. */
  revision: number;
  records: OutboxRecord[];
  problems: OutboxRecoveryProblem[];
}

export interface OutboxRemoval {
  clientId: string;
  /** Removal must be an explicit caller decision, never an age-based cleanup. */
  reason: "settled" | "canceled";
}

export interface OutboxSave {
  /** Revision returned by load or the last successful save. */
  revision: number;
  records: readonly OutboxRecord[];
  removals?: readonly OutboxRemoval[];
}

export interface OutboxStorageIO {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export type OutboxStorageErrorKind =
  | "corrupt"
  | "unsupported-version"
  | "invalid-record"
  | "read-failed"
  | "write-failed"
  | "stale-revision"
  | "unsafe-removal"
  | "immutable-send"
  | "recovery-required";

export class OutboxStorageError extends Error {
  constructor(
    public readonly kind: OutboxStorageErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "OutboxStorageError";
  }
}

/** Kept only in memory; corrupted on-disk bytes are never overwritten by load. */
export interface OutboxRecoveryState {
  kind: OutboxStorageErrorKind;
  message: string;
  /** Original corrupt JSON, or a proposed write that may not have landed. */
  raw: string | null;
}

interface DiskSnapshot {
  revision: number;
  records: OutboxRecord[];
  raw: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function nonEmpty(value: unknown, max = 256): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max
    && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function optionalText(value: unknown, max = 4096): boolean {
  return value === undefined || nonEmpty(value, max);
}

/** Paths and filenames may legitimately contain leading/trailing whitespace. */
function nonBlankBytes(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function natural(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function optionalNatural(value: unknown): boolean {
  return value === undefined || natural(value);
}

function parseTarget(value: unknown): OutboxTarget | null {
  if (!isRecord(value) || !onlyKeys(value, ["harness", "hostId", "profileId", "sessionId", "cwd"])
    || !nonEmpty(value.harness) || !optionalText(value.hostId) || !optionalText(value.profileId)
    || !optionalText(value.sessionId)
    || (value.cwd !== undefined && !nonBlankBytes(value.cwd, 8192))) return null;
  return {
    harness: value.harness,
    ...(typeof value.hostId === "string" ? { hostId: value.hostId } : {}),
    ...(typeof value.profileId === "string" ? { profileId: value.profileId } : {}),
    ...(typeof value.sessionId === "string" ? { sessionId: value.sessionId } : {}),
    ...(typeof value.cwd === "string" ? { cwd: value.cwd } : {}),
  };
}

function parseLocalFile(value: unknown): OutboxLocalFile | null {
  if (!isRecord(value) || !onlyKeys(value, ["uri", "name", "mime", "size"])
    || !nonBlankBytes(value.uri, 8192) || !nonBlankBytes(value.name, 255)
    || !nonBlankBytes(value.mime, 256) || !optionalNatural(value.size)) return null;
  return {
    uri: value.uri,
    name: value.name,
    mime: value.mime,
    ...(typeof value.size === "number" ? { size: value.size } : {}),
  };
}

function parsePayload(value: unknown): OutboxPayload | null {
  if (!isRecord(value) || !onlyKeys(value, ["text", "attachments", "localFiles", "summariesEnabled"])
    || typeof value.text !== "string"
    || (value.summariesEnabled !== undefined && typeof value.summariesEnabled !== "boolean")) return null;

  const uploaded = parseChatAttachments(value.attachments);
  if (uploaded === null) return null;
  const localFiles: OutboxLocalFile[] = [];
  if (value.localFiles !== undefined) {
    if (!Array.isArray(value.localFiles)) return null;
    for (const file of value.localFiles) {
      const parsed = parseLocalFile(file);
      if (!parsed) return null;
      localFiles.push(parsed);
    }
  }
  if ((uploaded?.length ?? 0) + localFiles.length > MAX_ATTACHMENTS_PER_TURN) return null;

  return {
    text: value.text,
    ...(uploaded !== undefined ? { attachments: uploaded } : {}),
    ...(value.localFiles !== undefined ? { localFiles } : {}),
    ...(typeof value.summariesEnabled === "boolean" ? { summariesEnabled: value.summariesEnabled } : {}),
  };
}

function parseOutboxRecord(value: unknown): OutboxRecord | null {
  if (!isRecord(value) || !onlyKeys(value, [
    "clientId", "turnId", "conversationId", "target", "mode", "payload",
    "stage", "attempts", "createdAt", "updatedAt", "lastSentAt",
    "ackedAt", "startedAt", "retryNeeded", "error",
  ])) return null;

  const target = parseTarget(value.target);
  const payload = parsePayload(value.payload);
  if (!nonEmpty(value.clientId) || !nonEmpty(value.turnId) || !nonEmpty(value.conversationId)
    || !target || !payload
    || (value.mode !== "send" && value.mode !== "steer" && value.mode !== "queue")
    || (value.stage !== "queued" && value.stage !== "sent" && value.stage !== "acked-by-bridge" && value.stage !== "started")
    || !natural(value.attempts) || !natural(value.createdAt) || !natural(value.updatedAt)
    || value.updatedAt < value.createdAt
    || !optionalNatural(value.lastSentAt) || !optionalNatural(value.ackedAt)
    || !optionalNatural(value.startedAt)
    || (value.retryNeeded !== undefined && typeof value.retryNeeded !== "boolean")
    || (value.error !== undefined && (typeof value.error !== "string" || value.error.length > 8192))) return null;

  return {
    clientId: value.clientId,
    turnId: value.turnId,
    conversationId: value.conversationId,
    target,
    mode: value.mode,
    payload,
    stage: value.stage,
    attempts: value.attempts,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(typeof value.lastSentAt === "number" ? { lastSentAt: value.lastSentAt } : {}),
    ...(typeof value.ackedAt === "number" ? { ackedAt: value.ackedAt } : {}),
    ...(typeof value.startedAt === "number" ? { startedAt: value.startedAt } : {}),
    ...(typeof value.retryNeeded === "boolean" ? { retryNeeded: value.retryNeeded } : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
}

function validatedRecords(value: unknown): OutboxRecord[] {
  if (!Array.isArray(value)) {
    throw new OutboxStorageError("invalid-record", "Outbox records are not a list. Preserve local data and recover before sending.");
  }
  const records: OutboxRecord[] = [];
  const clientIds = new Set<string>();
  const turnIds = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    const item = parseOutboxRecord(value[index]);
    if (!item) {
      throw new OutboxStorageError("invalid-record", "Outbox entry " + (index + 1) + " is invalid. Keep the stored copy; do not retry blindly.");
    }
    if (clientIds.has(item.clientId) || turnIds.has(item.turnId)) {
      throw new OutboxStorageError("invalid-record", "Repeated outbox clientId or turnId. Keep the stored copy for reconciliation.");
    }
    clientIds.add(item.clientId);
    turnIds.add(item.turnId);
    records.push(item);
  }
  return records;
}

function decode(raw: string): DiskSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new OutboxStorageError("corrupt", "Outbox JSON is damaged. Preserve the local journal and recover it before sending.");
  }
  if (!isRecord(value)) {
    throw new OutboxStorageError("corrupt", "Outbox JSON has no envelope. Preserve the local journal and recover it.");
  }
  if (value.version !== 1) {
    throw new OutboxStorageError("unsupported-version", "Unsupported outbox storage version. Update Dash or recover the journal; do not reset unsent turns.");
  }
  if (!onlyKeys(value, ["version", "revision", "records"]) || !natural(value.revision)) {
    throw new OutboxStorageError("corrupt", "Outbox revision or envelope is invalid. Preserve the local journal and recover it.");
  }
  return { revision: value.revision, records: validatedRecords(value.records), raw };
}

function fileProblems(records: readonly OutboxRecord[]): OutboxRecoveryProblem[] {
  return records.flatMap(record => (record.payload.localFiles ?? []).map((file): OutboxRecoveryProblem => ({
    kind: "local-file-reselect",
    clientId: record.clientId,
    turnId: record.turnId,
    fileName: file.name,
    message: "Local file may be unavailable after restart. Re-select and upload it before retrying this turn.",
  })));
}

function snapshot(disk: DiskSnapshot): OutboxSnapshot {
  return { revision: disk.revision, records: disk.records, problems: fileProblems(disk.records) };
}

function stageRank(stage: OutboxStage): number {
  switch (stage) {
    case "queued": return 0;
    case "sent": return 1;
    case "acked-by-bridge": return 2;
    case "started": return 3;
  }
}

function checkRemovals(
  prior: readonly OutboxRecord[],
  next: readonly OutboxRecord[],
  removals: readonly OutboxRemoval[],
): void {
  const remaining = new Map(next.map(item => [item.clientId, item]));
  const removed = new Map<string, string>();
  for (const removal of removals) {
    if (!nonEmpty(removal.clientId) || (removal.reason !== "settled" && removal.reason !== "canceled")
      || removed.has(removal.clientId) || remaining.has(removal.clientId)
      || !prior.some(item => item.clientId === removal.clientId)) {
      throw new OutboxStorageError("unsafe-removal", "Outbox removal must name one existing, omitted clientId and an explicit reason.");
    }
    removed.set(removal.clientId, removal.reason);
  }
  for (const item of prior) {
    const updated = remaining.get(item.clientId);
    if (!updated) {
      const reason = removed.get(item.clientId);
      if (!reason) {
        throw new OutboxStorageError("unsafe-removal", "An unresolved outbox turn disappeared without explicit settlement or cancellation.");
      }
      if (reason === "canceled" && item.stage !== "queued") {
        throw new OutboxStorageError("unsafe-removal", "A sent or acknowledged turn cannot be canceled locally. Reconcile host execution before removing it.");
      }
      continue;
    }
    if (updated.turnId !== item.turnId || updated.conversationId !== item.conversationId
      || stageRank(updated.stage) < stageRank(item.stage)
      || (item.stage !== "queued" && (
        updated.mode !== item.mode
        || JSON.stringify(updated.target) !== JSON.stringify(item.target)
        || JSON.stringify(updated.payload) !== JSON.stringify(item.payload)
      ))) {
      throw new OutboxStorageError("immutable-send", "Sent outbox identity, target, mode, or payload cannot change. Reconcile before editing.");
    }
  }
}

/**
 * Operations serialize on a single adapter instance. The revision guard catches
 * stale overlapping snapshots; it is not a cross-process transaction primitive.
 * The caller must await save before clearing the composer or sending a socket frame.
 */
export function createOutboxStorage(io: OutboxStorageIO) {
  let tail: Promise<void> = Promise.resolve();
  let recovery: OutboxRecoveryState | null = null;
  let failedWrite: string | null = null;

  function serialize<T>(job: () => Promise<T>): Promise<T> {
    const operation = tail.then(job);
    tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async function readDisk(): Promise<DiskSnapshot> {
    let raw: string | null;
    try {
      raw = await io.getItem(OUTBOX_STORAGE_KEY);
    } catch {
      const error = new OutboxStorageError("read-failed", "Cannot read the device outbox. Keep your draft and retry after storage is available.");
      recovery = { kind: error.kind, message: error.message, raw: null };
      throw error;
    }
    if (raw === null) return { revision: 0, records: [], raw: null };
    try {
      return decode(raw);
    } catch (error) {
      if (error instanceof OutboxStorageError) {
        recovery = { kind: error.kind, message: error.message, raw };
        throw error;
      }
      throw error;
    }
  }

  return {
    load(): Promise<OutboxSnapshot> {
      return serialize(async () => snapshot(await readDisk()));
    },

    save(input: OutboxSave): Promise<OutboxSnapshot> {
      // Clone and validate synchronously, before another async writer can mutate
      // the caller's objects while a previous setItem is pending.
      let records: OutboxRecord[];
      let removals: OutboxRemoval[];
      try {
        if (!natural(input.revision)) {
          throw new OutboxStorageError("stale-revision", "Outbox save requires the revision from load or the last successful save.");
        }
        records = validatedRecords(input.records);
        removals = (input.removals ?? []).map(item => ({ clientId: item.clientId, reason: item.reason }));
      } catch (error) {
        return Promise.reject(error);
      }

      const expected = input.revision;
      return serialize(async () => {
        const current = await readDisk();
        const encoded = JSON.stringify({ version: 1, revision: expected + 1, records });
        if (failedWrite !== null && failedWrite !== encoded) {
          throw new OutboxStorageError("recovery-required", "A previous outbox write failed. Reconcile its retained bytes before another save.");
        }
        // setItem may have committed and then thrown. A byte-for-byte readback
        // confirms that retrying the identical write is unnecessary.
        if (failedWrite === encoded && current.raw === encoded) {
          failedWrite = null;
          recovery = null;
          return snapshot(current);
        }
        if (current.revision !== expected) {
          throw new OutboxStorageError("stale-revision", "Outbox changed since this snapshot. Reload, merge by clientId, and retry; never overwrite it.");
        }
        if (!Number.isSafeInteger(expected + 1)) {
          throw new OutboxStorageError("stale-revision", "Outbox revision exhausted. Preserve the journal and migrate it.");
        }
        checkRemovals(current.records, records, removals);
        try {
          await io.setItem(OUTBOX_STORAGE_KEY, encoded);
        } catch {
          const error = new OutboxStorageError("write-failed", "Could not durably save this turn. Keep the composer content; do not transmit it.");
          failedWrite = encoded;
          recovery = { kind: error.kind, message: error.message, raw: encoded };
          throw error;
        }
        failedWrite = null;
        recovery = null;
        return snapshot({ revision: expected + 1, records, raw: encoded });
      });
    },

    getRecoveryState(): OutboxRecoveryState | null {
      return recovery ? { ...recovery } : null;
    },
  };
}
