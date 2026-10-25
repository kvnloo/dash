import { describe, expect, test } from "bun:test";
import type { BridgePrincipal } from "./z0bridge-identity";
import {
  DeliveryAdmissionConflict,
  DeliveryAdmissionController,
  deliveryFingerprint,
  deliveryInputFromChat,
  deliveryPrincipalScope,
  type DeliveryAdmissionInput,
  type DeliveryAdmissionLedger,
  type DeliveryAdmissionRecord,
  type DeliveryAdmissionState,
} from "./delivery-dedupe";

const alice: BridgePrincipal = {
  kind: "identity",
  subject: "cred_alice",
  token: "ALICE_ACCESS_TOKEN_MUST_NOT_BE_STORED",
  expiresAt: 2000000000000,
};
const refreshedAlice: BridgePrincipal = {
  kind: "identity",
  subject: "cred_alice",
  token: "DIFFERENT_ACCESS_TOKEN_MUST_NOT_BE_STORED",
  expiresAt: 2000000100000,
};
const bob: BridgePrincipal = {
  kind: "identity",
  subject: "cred_bob",
  token: "BOB_ACCESS_TOKEN_MUST_NOT_BE_STORED",
  expiresAt: 2000000000000,
};

function input(overrides: Partial<DeliveryAdmissionInput> = {}): DeliveryAdmissionInput {
  return {
    principal: alice,
    clientId: "client-1",
    turnId: "turn-1",
    target: {
      hostId: "laptop",
      profileId: "hermes:default",
      sessionId: "session-1",
      harness: "hermes",
      cwd: "/repo",
    },
    mode: "queue",
    text: "hello message secret body",
    attachments: [
      { id: "a".repeat(32), name: "plot.png", mime: "image/png", size: 10 },
      { id: "b".repeat(32), name: "notes.txt", mime: "text/plain", size: 20 },
    ],
    summariesEnabled: false,
    ...overrides,
  };
}

/** A real atomic insert-if-absent/CAS in-memory implementation of the injected contract. */
class MemoryLedger implements DeliveryAdmissionLedger {
  readonly records = new Map<string, DeliveryAdmissionRecord>();
  reserveCalls = 0;
  updateCalls = 0;
  failReserveBefore = false;
  failReserveAfter = false;
  failUpdate = false;
  failGet = false;

  private key(scope: string, id: string): string {
    return JSON.stringify([scope, id]);
  }

  async get(scope: string, id: string): Promise<DeliveryAdmissionRecord | null> {
    if (this.failGet) throw new Error("ledger read failed");
    const row = this.records.get(this.key(scope, id));
    return row ? { ...row } : null;
  }

  async reserve(candidate: DeliveryAdmissionRecord): Promise<{ record: DeliveryAdmissionRecord; created: boolean }> {
    this.reserveCalls++;
    if (this.failReserveBefore) {
      this.failReserveBefore = false;
      throw new Error("fsync failed before reservation");
    }
    const key = this.key(candidate.principalScope, candidate.clientId);
    const prior = this.records.get(key);
    if (prior) return { record: { ...prior }, created: false };
    this.records.set(key, { ...candidate });
    if (this.failReserveAfter) {
      this.failReserveAfter = false;
      throw new Error("response lost after durable reservation");
    }
    return { record: { ...candidate }, created: true };
  }

  async update(next: DeliveryAdmissionRecord, expected: DeliveryAdmissionState): Promise<DeliveryAdmissionRecord> {
    this.updateCalls++;
    if (this.failUpdate) {
      this.failUpdate = false;
      throw new Error("fsync failed on transition");
    }
    const key = this.key(next.principalScope, next.clientId);
    const prior = this.records.get(key);
    if (!prior || prior.state !== expected) throw new Error("admission state changed");
    if (prior.receiptId !== next.receiptId || prior.fingerprint !== next.fingerprint) {
      throw new Error("attempted to change immutable admission fields");
    }
    this.records.set(key, { ...next });
    return { ...next };
  }
}

describe("authenticated delivery admission", () => {
  test("adapts the chat frame and retains old chat.id when clientId is absent", () => {
    const original = deliveryInputFromChat(alice, {
      type: "chat", id: "turn-1", harness: "hermes", text: "send", mode: "queue",
      hostId: "laptop", profileId: "p", sessionId: "s",
    });
    const newClient = deliveryInputFromChat(alice, {
      type: "chat", id: "turn-1", clientId: "new-client", harness: "hermes", text: "send",
      hostId: "laptop", profileId: "p", sessionId: "s",
    });
    expect(original.clientId).toBe("turn-1");
    expect(newClient.clientId).toBe("new-client");
    expect(newClient.turnId).toBe("turn-1");
    expect(newClient.target.sessionId).toBe("s");
    expect(newClient.principal).toBe(alice);
    expect(deliveryFingerprint(input({ mode: undefined }))).toBe(deliveryFingerprint(input()));
  });

  test("principal scope is stable across token refresh and legacy is one shared scope", () => {
    expect(deliveryPrincipalScope(alice)).toBe(deliveryPrincipalScope(refreshedAlice));
    expect(deliveryPrincipalScope(alice)).not.toBe(deliveryPrincipalScope(bob));
    expect(deliveryPrincipalScope({ kind: "legacy" })).toBe("legacy:shared");
    expect(() => deliveryPrincipalScope({ kind: "identity", subject: "", token: "x", expiresAt: 1 })).toThrow();
  });

  test("concurrent identical duplicates start once and return the same receipt/turn", async () => {
    const ledger = new MemoryLedger();
    let release = () => {};
    const wait = new Promise<void>(resolve => { release = resolve; });
    let starts = 0;
    const controller = new DeliveryAdmissionController(ledger, async () => {
      starts++;
      await wait;
    }, () => 100);
    const pending = Array.from({ length: 20 }, () => controller.admit(input()));
    release();
    const results = await Promise.all(pending);
    expect(starts).toBe(1);
    expect(ledger.reserveCalls).toBe(1);
    expect(ledger.updateCalls).toBe(1);
    expect(new Set(results.map(result => result.receiptId)).size).toBe(1);
    expect(results.every(result => result.clientId === "client-1" && result.turnId === "turn-1")).toBe(true);
    expect(results.every(result => result.state === "started")).toBe(true);
    expect(results.filter(result => result.replay).length).toBe(19);
  });

  test("different payload fails even while an identical admission is in flight", async () => {
    const ledger = new MemoryLedger();
    let release = () => {};
    const wait = new Promise<void>(resolve => { release = resolve; });
    const controller = new DeliveryAdmissionController(ledger, async () => wait);
    const pending = controller.admit(input());
    await expect(controller.admit(input({ text: "changed while pending" }))).rejects.toBeInstanceOf(DeliveryAdmissionConflict);
    release();
    await pending;
    expect(ledger.reserveCalls).toBe(1);
  });

  test("atomic shared ledger stops duplicate execution across controller instances", async () => {
    const ledger = new MemoryLedger();
    let release = () => {};
    const wait = new Promise<void>(resolve => { release = resolve; });
    let starts = 0;
    const start = async () => { starts++; await wait; };
    const firstController = new DeliveryAdmissionController(ledger, start, () => 10);
    const secondController = new DeliveryAdmissionController(ledger, start, () => 10);
    const first = firstController.admit(input());
    const second = secondController.admit(input());
    release();
    const receipts = await Promise.all([first, second]);
    expect(starts).toBe(1);
    expect(receipts[0]?.receiptId).toBe(receipts[1]?.receiptId);
    expect(receipts[0]?.turnId).toBe(receipts[1]?.turnId);
    expect(ledger.reserveCalls).toBe(2);
    expect(receipts.some(result => result.replay)).toBe(true);
  });

  test("lost-ack replay and process reconstruction return the original ids without a second start", async () => {
    const ledger = new MemoryLedger();
    let starts = 0;
    const controller = new DeliveryAdmissionController(ledger, () => { starts++; }, () => 11);
    const first = await controller.admit(input());
    const replay = await controller.admit(input());
    const afterRestart = new DeliveryAdmissionController(ledger, () => { starts++; }, () => 12);
    const recovered = await afterRestart.admit(input());
    expect(first.state).toBe("started");
    expect(replay).toMatchObject({ receiptId: first.receiptId, turnId: first.turnId, state: "started", replay: true });
    expect(recovered).toMatchObject({ receiptId: first.receiptId, turnId: first.turnId, state: "started", replay: true });
    expect(starts).toBe(1);
  });

  test("same clientId with a changed immutable field is rejected, including attachment order", async () => {
    const ledger = new MemoryLedger();
    const controller = new DeliveryAdmissionController(ledger, () => {});
    const baseline = input();
    await controller.admit(baseline);
    const changes: DeliveryAdmissionInput[] = [
      input({ text: "different text" }),
      input({ turnId: "another-turn" }),
      input({ mode: "steer" }),
      input({ summariesEnabled: true }),
      input({ target: { ...baseline.target, hostId: "different-host" } }),
      input({ target: { ...baseline.target, profileId: "different-profile" } }),
      input({ target: { ...baseline.target, sessionId: "different-session" } }),
      input({ target: { ...baseline.target, harness: "omp" } }),
      input({ target: { ...baseline.target, cwd: "/different-repo" } }),
      input({ attachments: [{ id: "c".repeat(32), name: "plot.png", mime: "image/png", size: 10 }] }),
      input({ attachments: [...(baseline.attachments ?? [])].reverse() }),
    ];
    for (const changed of changes) {
      await expect(controller.admit(changed)).rejects.toBeInstanceOf(DeliveryAdmissionConflict);
    }
    expect(ledger.records.size).toBe(1);
  });

  test("different authenticated principals cannot see or collide with one another's receipts", async () => {
    const ledger = new MemoryLedger();
    let starts = 0;
    const controller = new DeliveryAdmissionController(ledger, () => { starts++; });
    const aliceReceipt = await controller.admit(input({ principal: alice }));
    expect(await controller.lookup(bob, "client-1")).toBeNull();
    const bobReceipt = await controller.admit(input({ principal: bob }));
    expect(starts).toBe(2);
    expect(bobReceipt.receiptId).not.toBe(aliceReceipt.receiptId);
    expect((await controller.lookup(refreshedAlice, "client-1"))?.receiptId).toBe(aliceReceipt.receiptId);
    const persisted = JSON.stringify([...ledger.records.values()]);
    expect(persisted).not.toContain("ALICE_ACCESS_TOKEN");
    expect(persisted).not.toContain("BOB_ACCESS_TOKEN");
    expect(persisted).not.toContain("hello message secret body");
    expect(persisted).toContain("fingerprint");
  });

  test("attachment and start work cannot begin before durable reservation completes", async () => {
    let releaseReservation = () => {};
    const commit = new Promise<void>(resolve => { releaseReservation = resolve; });
    const ledger = new class extends MemoryLedger {
      override async reserve(candidate: DeliveryAdmissionRecord): Promise<{ record: DeliveryAdmissionRecord; created: boolean }> {
        await commit;
        return super.reserve(candidate);
      }
    }();
    let observedState = "not started";
    const controller = new DeliveryAdmissionController(ledger, async admission => {
      const stored = await ledger.get(deliveryPrincipalScope(admission.principal), admission.clientId);
      observedState = stored?.state ?? "missing";
    });
    const pending = controller.admit(input());
    expect(observedState).toBe("not started");
    expect(ledger.records.size).toBe(0);
    releaseReservation();
    await pending;
    expect(observedState).toBe("admitted");
    expect((await controller.lookup(alice, "client-1"))?.state).toBe("started");
  });

  test("durability failure before reserve forbids start; retry after repair may start", async () => {
    const ledger = new MemoryLedger();
    ledger.failReserveBefore = true;
    let starts = 0;
    const controller = new DeliveryAdmissionController(ledger, () => { starts++; });
    await expect(controller.admit(input())).rejects.toThrow("fsync failed before reservation");
    expect(starts).toBe(0);
    expect(ledger.records.size).toBe(0);
    const retry = await controller.admit(input());
    expect(retry.state).toBe("started");
    expect(starts).toBe(1);
  });

  test("lost reserve response after durable commit never authorizes another execution", async () => {
    const ledger = new MemoryLedger();
    ledger.failReserveAfter = true;
    let starts = 0;
    const controller = new DeliveryAdmissionController(ledger, () => { starts++; });
    await expect(controller.admit(input())).rejects.toThrow("response lost after durable reservation");
    expect(starts).toBe(0);
    const replay = await controller.admit(input());
    expect(replay).toMatchObject({ state: "admitted", replay: true, reconciliationRequired: true });
    expect(starts).toBe(0);
  });

  test("callback failure is an unknown outcome, not a fresh retry", async () => {
    const ledger = new MemoryLedger();
    let starts = 0;
    const controller = new DeliveryAdmissionController(ledger, () => {
      starts++;
      throw new Error("start threw after spawning");
    });
    const outcome = await controller.admit(input());
    expect(outcome).toMatchObject({ state: "unknown", reconciliationRequired: true });
    expect((await controller.admit(input())).receiptId).toBe(outcome.receiptId);
    expect((await controller.lookup(alice, "client-1"))?.state).toBe("unknown");
    expect(starts).toBe(1);
    const terminal = await controller.markTerminal(alice, "client-1");
    expect(terminal?.state).toBe("terminal");
    expect(terminal?.reconciliationRequired).toBe(false);
    expect((await controller.admit(input())).state).toBe("terminal");
    expect(starts).toBe(1);
  });

  test("failed started-state fsync surfaces error; recovery never silently restarts", async () => {
    const ledger = new MemoryLedger();
    ledger.failUpdate = true;
    let starts = 0;
    const controller = new DeliveryAdmissionController(ledger, () => { starts++; });
    await expect(controller.admit(input())).rejects.toThrow("fsync failed on transition");
    expect(starts).toBe(1);
    expect((await controller.lookup(alice, "client-1"))?.state).toBe("admitted");
    const restarted = new DeliveryAdmissionController(ledger, () => { starts++; });
    const replay = await restarted.admit(input());
    expect(replay).toMatchObject({ state: "admitted", replay: true, reconciliationRequired: true });
    expect((await restarted.markUnknown(alice, "client-1"))?.state).toBe("unknown");
    expect(starts).toBe(1);
  });

  test("completion racing the start callback wins over a stale started write", async () => {
    const ledger = new MemoryLedger();
    let controller: DeliveryAdmissionController;
    controller = new DeliveryAdmissionController(ledger, async admitted => {
      const terminal = await controller.markTerminal(admitted.principal, admitted.clientId);
      expect(terminal?.state).toBe("terminal");
    });
    const outcome = await controller.admit(input());
    expect(outcome.state).toBe("terminal");
    expect((await controller.lookup(alice, "client-1"))?.state).toBe("terminal");
    expect((await controller.markUnknown(alice, "client-1"))?.state).toBe("terminal");
  });

  test("unknown and terminal states are idempotent, scoped, and never fabricate missing rows", async () => {
    const ledger = new MemoryLedger();
    const controller = new DeliveryAdmissionController(ledger, () => {});
    expect(await controller.markTerminal(alice, "missing")).toBeNull();
    expect(await controller.markUnknown(alice, "missing")).toBeNull();
    await controller.admit(input());
    expect((await controller.markUnknown(alice, "client-1"))?.state).toBe("unknown");
    expect((await controller.markUnknown(alice, "client-1"))?.state).toBe("unknown");
    expect(await controller.markTerminal(bob, "client-1")).toBeNull();
    const terminal = await controller.markTerminal(alice, "client-1");
    expect((await controller.markTerminal(alice, "client-1"))?.receiptId).toBe(terminal?.receiptId);
    expect((await controller.lookup(alice, "client-1"))?.state).toBe("terminal");
  });

  test("invalid identifiers and failed ledger reads fail closed before invoking start", async () => {
    const ledger = new MemoryLedger();
    let starts = 0;
    const controller = new DeliveryAdmissionController(ledger, () => { starts++; });
    await expect(controller.admit(input({ clientId: "" }))).rejects.toThrow("Invalid client id");
    await expect(controller.admit(input({ turnId: " " }))).rejects.toThrow("Invalid turn id");
    await expect(controller.admit(input({ target: { harness: "" } }))).rejects.toThrow("Invalid harness");
    ledger.failGet = true;
    await expect(controller.lookup(alice, "client-1")).rejects.toThrow("ledger read failed");
    expect(starts).toBe(0);
  });
});
