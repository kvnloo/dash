import { describe, expect, test } from "bun:test";
import {
  OUTBOX_STORAGE_KEY,
  OutboxStorageError,
  createOutboxStorage,
  type OutboxRecord,
  type OutboxStorageIO,
} from "./outbox-storage";

function entry(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    clientId: "client-A",
    turnId: "turn-A",
    conversationId: "conversation-A",
    target: {
      harness: "hermes",
      hostId: "host-A",
      profileId: "profile-A",
      sessionId: "session-A",
      cwd: "/repo/one",
    },
    mode: "steer",
    payload: {
      text: "Explain the change",
      attachments: [
        { id: "a".repeat(32), name: "photo.png", mime: "image/png", size: 123 },
      ],
      summariesEnabled: true,
    },
    stage: "sent",
    attempts: 1,
    createdAt: 1,
    updatedAt: 2,
    lastSentAt: 2,
    retryNeeded: true,
    error: "Bridge receipt not yet seen",
    ...overrides,
  };
}

function memory(seed: string | null = null) {
  let value = seed;
  const writes: string[] = [];
  const io: OutboxStorageIO = {
    async getItem(key) {
      expect(key).toBe(OUTBOX_STORAGE_KEY);
      return value;
    },
    async setItem(key, body) {
      expect(key).toBe(OUTBOX_STORAGE_KEY);
      writes.push(body);
      value = body;
    },
  };
  return { io, writes, value: () => value };
}

describe("versioned outbox storage", () => {
  test("fresh journal starts at revision zero; text, immutable ids, target, mode, and uploaded attachment ids survive recreation", async () => {
    const mem = memory();
    const first = entry();
    const second = entry({
      clientId: "client-B",
      turnId: "turn-B",
      conversationId: "conversation-B",
      mode: "queue",
      target: { harness: "omp", hostId: "host-B", cwd: "/repo/two" },
      payload: {
        text: "",
        attachments: [{ id: "b".repeat(32), name: "data.csv", mime: "text/csv", size: 42 }],
        localFiles: [{ uri: "content://image/123", name: "recent.jpg", mime: "image/jpeg", size: 50 }],
      },
      stage: "queued",
      attempts: 0,
      createdAt: 1,
      updatedAt: 1,
      lastSentAt: undefined,
      retryNeeded: undefined,
      error: undefined,
    });
    const original = createOutboxStorage(mem.io);
    expect(await original.load()).toEqual({ revision: 0, records: [], problems: [] });
    const written = await original.save({ revision: 0, records: [first, second] });
    expect(written.revision).toBe(1);
    expect(mem.writes).toHaveLength(1);
    expect(JSON.parse(mem.writes[0] ?? "{}").version).toBe(1);
    expect(mem.writes[0]).not.toContain("token");

    const restarted = createOutboxStorage(mem.io);
    const restored = await restarted.load();
    expect(restored.revision).toBe(1);
    expect(JSON.parse(JSON.stringify(restored.records))).toEqual(JSON.parse(JSON.stringify([first, second])));
    expect(restored.records[1]?.payload.attachments?.[0]?.id).toBe("b".repeat(32));
    expect(restored.problems).toEqual([{
      kind: "local-file-reselect",
      clientId: "client-B",
      turnId: "turn-B",
      fileName: "recent.jpg",
      message: "Local file may be unavailable after restart. Re-select and upload it before retrying this turn.",
    }]);
    expect(restarted.getRecoveryState()).toBeNull();
  });

  test("never ages out even ancient queued, sent, acked, or started messages", async () => {
    const mem = memory();
    const records = (["queued", "sent", "acked-by-bridge", "started"] satisfies OutboxRecord["stage"][])
      .map((stage, i) => entry({
        clientId: "client-" + i,
        turnId: "turn-" + i,
        stage,
        createdAt: 0,
        updatedAt: 0,
        lastSentAt: undefined,
      }));
    const store = createOutboxStorage(mem.io);
    await store.save({ revision: 0, records });
    expect((await createOutboxStorage(mem.io).load()).records).toEqual(records);
    expect(mem.value()).toContain('"createdAt":0');
    expect(mem.writes).toHaveLength(1);
  });

  test("malformed JSON, unknown versions, malformed records, duplicate turn ids, and unexpected secret keys fail closed", async () => {
    const inputs = [
      "{truncated",
      JSON.stringify({ version: 9, revision: 0, records: [entry()] }),
      JSON.stringify({ version: 1, revision: -1, records: [] }),
      JSON.stringify({ version: 1, revision: 0, records: [entry({ clientId: "" })] }),
      JSON.stringify({ version: 1, revision: 0, records: [entry(), entry({ clientId: "another" })] }),
      JSON.stringify({ version: 1, revision: 0, records: [{ ...entry(), token: "must-not-persist" }] }),
      JSON.stringify({ version: 1, revision: 0, records: [{ ...entry(), payload: { ...entry().payload, attachments: [{ id: "bad", name: "x", mime: "text/plain", size: 1 }] } }] }),
    ];
    for (const raw of inputs) {
      const mem = memory(raw);
      const store = createOutboxStorage(mem.io);
      await expect(store.load()).rejects.toBeInstanceOf(OutboxStorageError);
      expect(store.getRecoveryState()?.raw).toBe(raw);
      await expect(store.save({ revision: 0, records: [entry()] })).rejects.toBeInstanceOf(OutboxStorageError);
      expect(mem.value()).toBe(raw);
      expect(mem.writes).toHaveLength(0);
    }
  });

  test("invalid input is rejected before writes, including accidentally passed credentials", async () => {
    const mem = memory();
    const store = createOutboxStorage(mem.io);
    const unsafe = { ...entry(), target: { ...entry().target, token: "private" } };
    await expect(store.save({ revision: 0, records: [unsafe] })).rejects.toMatchObject({ kind: "invalid-record" });
    const broken = entry({ payload: { text: "bad", localFiles: [{ uri: "", name: "x", mime: "text/plain" }] } });
    await expect(store.save({ revision: 0, records: [broken] })).rejects.toMatchObject({ kind: "invalid-record" });
    expect(mem.value()).toBeNull();
  });

  test("missing entry requires explicit settlement/cancellation, and sent payload cannot be rewritten or regressed", async () => {
    const mem = memory();
    const store = createOutboxStorage(mem.io);
    await store.save({ revision: 0, records: [entry()] });
    await expect(store.save({ revision: 1, records: [] })).rejects.toMatchObject({ kind: "unsafe-removal" });
    await expect(store.save({
      revision: 1,
      records: [],
      removals: [{ clientId: "client-A", reason: "canceled" }],
    })).rejects.toMatchObject({ kind: "unsafe-removal" });
    await expect(store.save({ revision: 1, records: [entry({ payload: { text: "changed" } })] }))
      .rejects.toMatchObject({ kind: "immutable-send" });
    await expect(store.save({ revision: 1, records: [entry({ stage: "queued" })] }))
      .rejects.toMatchObject({ kind: "immutable-send" });
    expect((await store.load()).records).toEqual([entry()]);
    const removed = await store.save({
      revision: 1,
      records: [],
      removals: [{ clientId: "client-A", reason: "settled" }],
    });
    expect(removed.revision).toBe(2);
    expect((await store.load()).records).toEqual([]);
  });

  test("serialized overlapping writes reject stale revision instead of resurrecting an older snapshot", async () => {
    let raw: string | null = null;
    let enterFirst: (() => void) | undefined;
    let releaseFirst: (() => void) | undefined;
    const entered = new Promise<void>(resolve => { enterFirst = () => resolve(); });
    const barrier = new Promise<void>(resolve => { releaseFirst = () => resolve(); });
    let writes = 0;
    const io: OutboxStorageIO = {
      async getItem() { return raw; },
      async setItem(_key, value) {
        writes++;
        if (writes === 1) {
          enterFirst?.();
          await barrier;
        }
        raw = value;
      },
    };
    const store = createOutboxStorage(io);
    const first = store.save({ revision: 0, records: [entry()] });
    await entered;
    const obsolete = store.save({ revision: 0, records: [entry({ clientId: "obsolete", turnId: "old" })] });
    // Bun's expect(promise).rejects blocks until the promise settles, and this one
    // cannot settle before releaseFirst(); capture the outcome without blocking.
    const obsoleteRejected = obsolete.then(
      () => { throw new Error("obsolete save resolved; expected stale-revision"); },
      (error: unknown) => error,
    );
    const newestRecord = entry({ clientId: "client-B", turnId: "turn-B", conversationId: "conversation-B", stage: "queued", attempts: 0 });
    const newest = store.save({ revision: 1, records: [entry(), newestRecord] });
    releaseFirst?.();
    expect((await first).revision).toBe(1);
    expect(await obsoleteRejected).toMatchObject({ kind: "stale-revision" });
    expect((await newest).revision).toBe(2);
    expect((await createOutboxStorage(io).load()).records).toEqual([entry(), newestRecord]);
    expect(writes).toBe(2);
  });

  test("snapshots are cloned before asynchronous I/O and cannot be altered after calling save", async () => {
    const mem = memory();
    const record = entry();
    const pending = createOutboxStorage(mem.io).save({ revision: 0, records: [record] });
    record.payload.text = "modified after save was called";
    await pending;
    expect((await createOutboxStorage(mem.io).load()).records[0]?.payload.text).toBe("Explain the change");
  });

  test("write rejection is visible; failed proposal retained and different writes blocked until reconciled", async () => {
    let raw: string | null = null;
    let fail = true;
    const io: OutboxStorageIO = {
      async getItem() { return raw; },
      async setItem(_key, value) {
        if (fail) throw new Error("full disk");
        raw = value;
      },
    };
    const store = createOutboxStorage(io);
    await expect(store.save({ revision: 0, records: [entry()] }))
      .rejects.toMatchObject({ kind: "write-failed" });
    expect(raw).toBeNull();
    expect(store.getRecoveryState()?.raw).toContain('"clientId":"client-A"');
    await expect(store.save({ revision: 0, records: [] }))
      .rejects.toMatchObject({ kind: "recovery-required" });
    fail = false;
    expect((await store.save({ revision: 0, records: [entry()] })).revision).toBe(1);
    expect((await store.load()).records).toEqual([entry()]);
    expect(store.getRecoveryState()).toBeNull();
  });

  test("ambiguous setItem failure is reconciled by exact readback, never transmitted or written twice", async () => {
    let raw: string | null = null;
    let calls = 0;
    const io: OutboxStorageIO = {
      async getItem() { return raw; },
      async setItem(_key, value) {
        calls++;
        raw = value;
        throw new Error("response lost after commit");
      },
    };
    const store = createOutboxStorage(io);
    await expect(store.save({ revision: 0, records: [entry()] }))
      .rejects.toMatchObject({ kind: "write-failed" });
    expect((await store.save({ revision: 0, records: [entry()] })).revision).toBe(1);
    expect(calls).toBe(1);
    expect(store.getRecoveryState()).toBeNull();
  });

  test("read rejection is surfaced; no synthetic empty journal is returned", async () => {
    const store = createOutboxStorage({
      async getItem() { throw new Error("storage locked"); },
      async setItem() { throw new Error("should not write"); },
    });
    await expect(store.load()).rejects.toMatchObject({ kind: "read-failed" });
    expect(store.getRecoveryState()?.kind).toBe("read-failed");
    expect(store.getRecoveryState()?.raw).toBeNull();
  });
});
