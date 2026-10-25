import { describe, expect, test } from "bun:test";
import {
  createOutboxStore,
  type NewOutboxMessage,
  type OutboxPersistence,
  type OutboxReceipt,
  type OutboxRecord,
} from "./outbox";

function message(clientId: string, conversationId = "conversation-1"): NewOutboxMessage {
  return {
    clientId,
    turnId: `turn-${clientId}`,
    conversationId,
    target: {
      harness: "hermes",
      hostId: "host-1",
      sessionId: "session-1",
      cwd: "/workspace",
      mode: "queue",
    },
    payload: {
      text: `text for ${clientId}`,
      attachments: [{ id: "a".repeat(32), name: "image.png", mime: "image/png", size: 42 }],
      summariesEnabled: true,
    },
  };
}

function receipt(clientId: string, stage: OutboxReceipt["stage"] = "acked-by-bridge", at = 200): OutboxReceipt {
  return { type: "delivery_receipt", clientId, turnId: `turn-${clientId}`, stage, at };
}

function memoryStorage(initial: readonly OutboxRecord[] = []) {
  let disk = [...initial];
  let saves = 0;
  const persistence: OutboxPersistence = {
    async load() { return disk; },
    async save(next) {
      saves += 1;
      disk = [...next];
    },
  };
  return { persistence, read: () => disk, saves: () => saves };
}

describe("durable delivery outbox orchestration", () => {
  test("rejecting the first storage write retains caller draft and never invokes transport", async () => {
    let transportCalls = 0;
    const store = createOutboxStore({
      persistence: {
        async load() { return []; },
        async save() { throw new Error("disk full"); },
      },
      transport: { send() { transportCalls += 1; return true; } },
      now: () => 100,
    });
    const result = await store.enqueue(message("first"));
    expect(result).toMatchObject({ ok: false, reason: "storage" });
    if (!result.ok) expect(result.message).toContain("Keep caller draft");
    expect(store.get()).toHaveLength(0);
    expect(transportCalls).toBe(0);
  });

  test("socket true means sent only; authenticated matching receipts advance monotonically", async () => {
    const disk = memoryStorage();
    const sent: OutboxRecord[] = [];
    const store = createOutboxStore({
      persistence: disk.persistence,
      transport: { send(record) { sent.push(record); return true; } },
      now: () => 100,
    });
    const result = await store.enqueue(message("one"));
    expect(result).toMatchObject({ ok: true, value: { transport: "sent", record: { stage: "sent" } } });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.stage).toBe("queued");
    expect(store.get()[0]?.stage).toBe("sent");
    expect(store.get()[0]?.attempts).toBe(1);
    expect(Object.isFrozen(store.get()[0]?.target)).toBe(true);
    expect(Object.isFrozen(store.get()[0]?.payload.attachments?.[0])).toBe(true);

    const ack = await store.receiveReceipt(receipt("one"));
    expect(ack).toMatchObject({ ok: true, value: { stage: "acked-by-bridge" } });
    const writesAfterAck = disk.saves();
    await store.receiveReceipt(receipt("one", "acked-by-bridge", 300));
    expect(disk.saves()).toBe(writesAfterAck);
    const start = await store.receiveReceipt(receipt("one", "started", 301));
    expect(start).toMatchObject({ ok: true, value: { stage: "started" } });
    await store.receiveReceipt(receipt("one", "acked-by-bridge", 302));
    expect(store.get()[0]?.stage).toBe("started");
    expect(store.get()[0]?.receiptAt).toBe(301);
    expect(disk.read()[0]?.stage).toBe("started");
    expect(sent).toHaveLength(1);
  });

  test("locally queued work commits without transport and later dispatches its same turn", async () => {
    const disk = memoryStorage();
    const calls: OutboxRecord[] = [];
    const store = createOutboxStore({
      persistence: disk.persistence,
      transport: { send(record) { calls.push(record); return true; } },
      now: () => 100,
    });
    const deferred = await store.enqueue(message("deferred"), { dispatch: false });
    expect(deferred).toMatchObject({ ok: true, value: { transport: "queued", record: { attempts: 0, stage: "queued" } } });
    expect(calls).toHaveLength(0);
    expect(disk.read()[0]?.clientId).toBe("deferred");
    const flush = await store.retry("deferred", { dedupeSupported: false });
    expect(flush).toMatchObject({ ok: true, value: { transport: "sent" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.turnId).toBe("turn-deferred");
    expect(calls[0]?.target.mode).toBe("queue");
  });

  test("restart retains exact identifiers, target, attachments and requires dedupe on replay", async () => {
    const disk = memoryStorage();
    const first = createOutboxStore({
      persistence: disk.persistence,
      transport: { send() { return true; } },
      now: () => 100,
    });
    const input = message("restart", "conversation-9");
    const queued = await first.enqueue(input);
    expect(queued.ok).toBe(true);
    first.dispose();

    const calls: OutboxRecord[] = [];
    const restarted = createOutboxStore({
      persistence: disk.persistence,
      transport: { send(record) { calls.push(record); return true; } },
      now: () => 400,
    });
    const hydrated = await restarted.hydrate();
    expect(hydrated.ok).toBe(true);
    const restored = restarted.get()[0];
    expect(restored).toMatchObject({
      clientId: "restart", turnId: "turn-restart", conversationId: "conversation-9",
      stage: "sent", attempts: 1, target: input.target, payload: input.payload,
    });
    const unsafe = await restarted.retry("restart", { dedupeSupported: false });
    expect(unsafe).toMatchObject({ ok: false, reason: "unsafe-retry" });
    expect(calls).toHaveLength(0);

    const retry = await restarted.retry("restart", { dedupeSupported: true });
    expect(retry).toMatchObject({ ok: true, value: { transport: "sent" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.clientId).toBe("restart");
    expect(calls[0]?.turnId).toBe("turn-restart");
    expect(calls[0]?.payload).toEqual(input.payload);
    expect(calls[0]?.target).toEqual(input.target);
    expect(restarted.get()[0]?.attempts).toBe(2);
  });

  test("hydration pending during enqueue cannot overwrite either old or new messages", async () => {
    const old: OutboxRecord = {
      ...message("old", "old-conversation"), stage: "sent",
      attempts: 1, createdAt: 1, updatedAt: 1,
    };
    let releaseLoad: (items: readonly OutboxRecord[]) => void = () => undefined;
    const reading = new Promise<readonly OutboxRecord[]>(resolve => { releaseLoad = resolve; });
    const disk = memoryStorage();
    let transportCalls = 0;
    const store = createOutboxStore({
      persistence: { ...disk.persistence, load: () => reading },
      transport: { send() { transportCalls += 1; return false; } },
      now: () => 500,
    });
    const hydration = store.hydrate();
    const enqueue = store.enqueue(message("new", "new-conversation"));
    expect(transportCalls).toBe(0);
    releaseLoad([old]);
    const [loaded, accepted] = await Promise.all([hydration, enqueue]);
    expect(loaded.ok).toBe(true);
    expect(accepted.ok).toBe(true);
    expect(store.get().map(item => item.clientId).sort()).toEqual(["new", "old"]);
    expect(disk.read().map(item => item.clientId).sort()).toEqual(["new", "old"]);
    expect(store.get().find(item => item.clientId === "old")?.stage).toBe("sent");
    expect(transportCalls).toBe(1);
  });

  test("conversation isolation and wrong turn identities fail closed", async () => {
    const disk = memoryStorage();
    const store = createOutboxStore({
      persistence: disk.persistence,
      transport: { send() { return false; } },
      now: () => 100,
    });
    await store.enqueue(message("a", "conversation-a"));
    await store.enqueue(message("b", "conversation-b"));

    const wrong = await store.receiveReceipt({ ...receipt("a"), turnId: "turn-b" });
    expect(wrong).toMatchObject({ ok: false, reason: "mismatch" });
    const unknown = await store.receiveReceipt(receipt("missing"));
    expect(unknown).toMatchObject({ ok: false, reason: "not-found" });
    await store.receiveReceipt(receipt("a"));
    expect(store.get().find(item => item.conversationId === "conversation-a")?.stage).toBe("acked-by-bridge");
    expect(store.get().find(item => item.conversationId === "conversation-b")?.stage).toBe("queued");

    const duplicateClient = await store.enqueue(message("a", "conversation-b"));
    expect(duplicateClient).toMatchObject({ ok: false, reason: "duplicate" });
    const duplicateTurn = await store.enqueue({
      ...message("c", "conversation-b"), turnId: "turn-b",
    });
    expect(duplicateTurn).toMatchObject({ ok: false, reason: "duplicate" });
    expect(store.get()).toHaveLength(2);
  });

  test("a late send completion cannot regress a receipt or overwrite persisted acknowledgement", async () => {
    const disk = memoryStorage();
    let enterTransport: () => void = () => undefined;
    let finishTransport: (accepted: boolean) => void = () => undefined;
    const entered = new Promise<void>(resolve => { enterTransport = resolve; });
    const held = new Promise<boolean>(resolve => { finishTransport = resolve; });
    const store = createOutboxStore({
      persistence: disk.persistence,
      transport: { send() { enterTransport(); return held; } },
      now: () => 100,
    });
    const pending = store.enqueue(message("race"));
    await entered;
    expect(store.get()[0]?.attempts).toBe(1);
    const acknowledged = await store.receiveReceipt(receipt("race"));
    expect(acknowledged).toMatchObject({ ok: true, value: { stage: "acked-by-bridge" } });
    finishTransport(true);
    const result = await pending;
    expect(result).toMatchObject({ ok: true, value: { transport: "confirmed" } });
    expect(store.get()[0]?.stage).toBe("acked-by-bridge");
    expect(disk.read()[0]?.stage).toBe("acked-by-bridge");
  });

  test("serialized writes do not allow delayed saves to erase a newer receipt", async () => {
    let disk: readonly OutboxRecord[] = [];
    let firstSaveStarted: () => void = () => undefined;
    let releaseFirst: () => void = () => undefined;
    const firstStarted = new Promise<void>(resolve => { firstSaveStarted = resolve; });
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    let writeCount = 0;
    const persistence: OutboxPersistence = {
      async load() { return []; },
      async save(next) {
        writeCount += 1;
        if (writeCount === 1) {
          firstSaveStarted();
          await firstGate;
        }
        disk = [...next];
      },
    };
    const store = createOutboxStore({
      persistence,
      transport: { send() { return true; } },
      now: () => 100,
    });
    const pending = store.enqueue(message("serial"));
    await firstStarted;
    const ack = store.receiveReceipt(receipt("serial"));
    releaseFirst();
    await Promise.all([pending, ack]);
    expect(disk[0]?.stage).toBe("acked-by-bridge");
    expect(store.get()[0]?.stage).toBe("acked-by-bridge");
  });

  test("post-send save failure is not mislabeled a confirmed send or a lost draft", async () => {
    let saves = 0;
    let transmissions = 0;
    let persisted: readonly OutboxRecord[] = [];
    const store = createOutboxStore({
      persistence: {
        async load() { return []; },
        async save(items) {
          saves += 1;
          if (saves === 3) throw new Error("write failed after socket");
          persisted = [...items];
        },
      },
      transport: { send() { transmissions += 1; return true; } },
      now: () => 100,
    });
    const result = await store.enqueue(message("uncertain"));
    expect(result).toMatchObject({ ok: true, value: { transport: "unconfirmed" } });
    expect(transmissions).toBe(1);
    expect(persisted[0]).toMatchObject({ stage: "queued", attempts: 1 });
    const unsafe = await store.retry("uncertain", { dedupeSupported: false });
    expect(unsafe).toMatchObject({ ok: false, reason: "unsafe-retry" });
  });

  test("disconnect marks unacknowledged sends for safe recovery without replaying started turns", async () => {
    const disk = memoryStorage();
    const store = createOutboxStore({
      persistence: disk.persistence,
      transport: { send() { return true; } },
      now: () => 100,
    });
    await store.enqueue(message("live"));
    await store.enqueue(message("finished"));
    await store.receiveReceipt(receipt("finished", "started"));
    const result = await store.disconnect();
    expect(result).toEqual({ ok: true, value: 1 });
    expect(store.get().find(item => item.clientId === "live")?.retryNeeded).toBe(true);
    expect(store.get().find(item => item.clientId === "finished")?.retryNeeded).toBe(false);
    const safe = await store.retry("live", { dedupeSupported: true });
    expect(safe.ok).toBe(true);
    const confirmed = await store.retry("finished", { dedupeSupported: true });
    expect(confirmed).toMatchObject({ ok: false, reason: "confirmed" });
  });

  test("dispose removes observers and prevents new dispatch or receipt writes", async () => {
    const disk = memoryStorage();
    let observed = 0;
    let sends = 0;
    const store = createOutboxStore({
      persistence: disk.persistence,
      transport: { send() { sends += 1; return true; } },
      now: () => 100,
    });
    const unsubscribe = store.subscribe(() => { observed += 1; });
    await store.enqueue(message("last"));
    expect(observed).toBeGreaterThan(0);
    store.dispose();
    unsubscribe();
    const count = observed;
    expect(await store.receiveReceipt(receipt("last"))).toMatchObject({ ok: false, reason: "disposed" });
    expect(await store.retry("last", { dedupeSupported: true })).toMatchObject({ ok: false, reason: "disposed" });
    expect(await store.enqueue(message("after-dispose"))).toMatchObject({ ok: false, reason: "disposed" });
    expect(observed).toBe(count);
    expect(sends).toBe(1);
    expect(disk.read()).toHaveLength(1);
  });

  test("disposing during an unresolved hydration aborts queued mutations before disk or network", async () => {
    let release: (rows: readonly OutboxRecord[]) => void = () => undefined;
    const loading = new Promise<readonly OutboxRecord[]>(resolve => { release = resolve; });
    let writes = 0;
    let transmissions = 0;
    const store = createOutboxStore({
      persistence: {
        load: () => loading,
        async save() { writes += 1; },
      },
      transport: { send() { transmissions += 1; return true; } },
      now: () => 100,
    });
    const pending = store.enqueue(message("pending-dispose"));
    store.dispose();
    release([]);
    expect(await pending).toMatchObject({ ok: false, reason: "disposed" });
    expect(writes).toBe(0);
    expect(transmissions).toBe(0);
  });

  test("transport exceptions remain unconfirmed and cannot trigger unsafe retry", async () => {
    const disk = memoryStorage();
    const store = createOutboxStore({
      persistence: disk.persistence,
      transport: { send() { throw new Error("socket closed while writing"); } },
      now: () => 100,
    });
    const result = await store.enqueue(message("socket-unknown"));
    expect(result).toMatchObject({ ok: true, value: { transport: "unconfirmed" } });
    expect(disk.read()[0]).toMatchObject({ stage: "queued", attempts: 1, retryNeeded: true });
    expect(await store.retry("socket-unknown", { dedupeSupported: false }))
      .toMatchObject({ ok: false, reason: "unsafe-retry" });
  });

  test("corrupt hydration exposes the error rather than replacing unsent data", async () => {
    let writes = 0;
    const store = createOutboxStore({
      persistence: {
        async load() { throw new Error("unsupported storage version"); },
        async save() { writes += 1; },
      },
      transport: { send() { throw new Error("should not run"); } },
      now: () => 100,
    });
    expect(await store.hydrate()).toMatchObject({ ok: false, reason: "storage" });
    expect(await store.enqueue(message("blocked"))).toMatchObject({ ok: false, reason: "storage" });
    expect(writes).toBe(0);
  });
});
