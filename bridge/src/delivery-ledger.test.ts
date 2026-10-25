import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_LEDGER_MAX_ENTRIES,
  DeliveryLedger,
  DeliveryLedgerCapacityError,
  DeliveryLedgerConflictError,
  DeliveryLedgerCorruptError,
  DeliveryLedgerUnavailableError,
  LEDGER_FILENAME,
  nodeDeliveryLedgerFilesystem,
} from "./delivery-ledger";
import type {
  DeliveryLedgerFilesystem,
  DeliveryLedgerKey,
  DeliveryLedgerReservation,
} from "./delivery-ledger";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const A = "a".repeat(64);
const B = "b".repeat(64);

function reservation(
  clientId: string,
  at = 100,
  principalId = "principal:alpha",
  fingerprint = A,
): DeliveryLedgerReservation {
  return { principalId, clientId, fingerprint, turnId: "turn:" + clientId, at };
}

function identity(clientId: string, principalId = "principal:alpha"): DeliveryLedgerKey {
  return { principalId, clientId };
}

async function withDir(run: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(join(tmpdir(), "dash-delivery-ledger-"));
  try {
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function opened(root: string, filesystem?: DeliveryLedgerFilesystem): Promise<DeliveryLedger> {
  const ledger = new DeliveryLedger({ root, filesystem });
  await ledger.load();
  return ledger;
}

type Fault = "write" | "file-sync" | "rename" | "directory-sync" | "read";

function faultyFilesystem(fault: Fault): DeliveryLedgerFilesystem {
  return {
    ...nodeDeliveryLedgerFilesystem,
    readFile: async (path) => {
      if (fault === "read") throw new Error("injected disk read error");
      return nodeDeliveryLedgerFilesystem.readFile(path);
    },
    rename: async (from, to) => {
      if (fault === "rename") throw new Error("injected rename failure");
      await nodeDeliveryLedgerFilesystem.rename(from, to);
    },
    open: async (path, flags) => {
      const handle = await nodeDeliveryLedgerFilesystem.open(path, flags);
      return {
        writeFile: async (contents) => {
          if (fault === "write" && flags === "wx") throw new Error("injected disk full");
          await handle.writeFile(contents);
        },
        sync: async () => {
          if (fault === "file-sync" && flags === "wx") throw new Error("injected file sync failure");
          if (fault === "directory-sync" && flags === "r") throw new Error("injected directory sync failure");
          await handle.sync();
        },
        close: () => handle.close(),
      };
    },
  };
}

describe("crash-safe bridge delivery ledger", () => {
  test("requires a load before either read or admission", async () => {
    await withDir(async (root) => {
      const ledger = new DeliveryLedger({ root });
      await expect(ledger.get(identity("a"))).rejects.toBeInstanceOf(DeliveryLedgerUnavailableError);
      await expect(ledger.reserve(reservation("a"))).rejects.toBeInstanceOf(DeliveryLedgerUnavailableError);
      await ledger.load();
      expect(await ledger.get(identity("a"))).toBeUndefined();
    });
  });

  test("reopens real disk state with identical identity, receipt and timestamps", async () => {
    await withDir(async (root) => {
      const ledger = await opened(root);
      const admitted = await ledger.reserve(reservation("one", 100));
      expect(admitted).toEqual({
        principalId: "principal:alpha", clientId: "one", fingerprint: A,
        turnId: "turn:one", at: 100, admittedAt: 100, updatedAt: 100,
        state: "admitted", reconciliationRequired: false,
        receipt: {
          type: "delivery_receipt", clientId: "one", turnId: "turn:one",
          stage: "acked-by-bridge", at: 100,
        },
      });
      const started = await ledger.reserve(reservation("two", 120));
      const startedEntry = await ledger.update(identity("two"), { state: "started", at: 125 });
      expect("finishedAt" in startedEntry).toBe(false);
      await ledger.reserve(reservation("three", 150));
      await ledger.update(identity("three"), { state: "started", at: 155 });
      const completed = await ledger.update(identity("three"), { state: "completed", at: 160 });

      const raw = await fs.readFile(join(root, LEDGER_FILENAME), "utf8");
      const stored: unknown = JSON.parse(raw);
      expect(isObject(stored) && stored.version).toBe(1);
      expect(raw).toContain(A);
      expect(raw).not.toContain("authorization");
      expect(raw).not.toContain("messageBody");

      const recovered = await opened(root);
      const reopenedAdmitted = await recovered.get(identity("one"));
      expect(reopenedAdmitted).toEqual({ ...admitted, reconciliationRequired: true });
      expect("startedAt" in (reopenedAdmitted ?? {})).toBe(false);
      expect("finishedAt" in (reopenedAdmitted ?? {})).toBe(false);
      expect(await recovered.get(identity("two"))).toEqual({
        ...started, state: "started", startedAt: 125, updatedAt: 125,
        receipt: {
          type: "delivery_receipt", clientId: "two", turnId: "turn:two",
          stage: "started", at: 125,
        },
        reconciliationRequired: true,
      });
      expect(await recovered.get(identity("three"))).toEqual(completed);
      // An acknowledged reservation is not proof that a restarted bridge
      // may execute it: replay yields the old receipt, not a new turn.
      const replay = await recovered.reserve({
        ...reservation("one", 999), turnId: "discarded-new-turn",
      });
      expect(replay.turnId).toBe("turn:one");
      expect(replay.receipt).toEqual(admitted.receipt);
      expect(replay.reconciliationRequired).toBe(true);
    });
  });

  test("duplicate reservations serialize; principal isolation and collision fail closed", async () => {
    await withDir(async (root) => {
      const ledger = await opened(root);
      const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
        ledger.reserve({ ...reservation("same", 100 + i), turnId: "candidate:" + i })));
      expect(results.map((entry) => entry.turnId)).toEqual(Array(20).fill("candidate:0"));
      expect(results.map((entry) => entry.receipt.at)).toEqual(Array(20).fill(100));
      await expect(ledger.reserve(reservation("same", 200, "principal:alpha", B)))
        .rejects.toBeInstanceOf(DeliveryLedgerConflictError);
      const otherPrincipal = await ledger.reserve(reservation("same", 300, "principal:beta", B));
      expect(otherPrincipal.principalId).toBe("principal:beta");
      expect(otherPrincipal.turnId).toBe("turn:same");
      expect((await ledger.get(identity("same")))?.fingerprint).toBe(A);
      expect((await ledger.get(identity("same", "principal:beta")))?.fingerprint).toBe(B);
      const reopened = await opened(root);
      expect((await reopened.get(identity("same")))?.turnId).toBe("candidate:0");
      expect((await reopened.get(identity("same", "principal:beta")))?.turnId).toBe("turn:same");
    });
  });

  test("durable parallel reservations and updates never overwrite each other", async () => {
    await withDir(async (root) => {
      const ledger = await opened(root);
      await Promise.all(Array.from({ length: 12 }, (_, i) => ledger.reserve(reservation("c" + i, 10))));
      await Promise.all(Array.from({ length: 12 }, (_, i) =>
        ledger.update(identity("c" + i), { state: "started", at: 20 })));
      await Promise.all(Array.from({ length: 6 }, (_, i) =>
        ledger.update(identity("c" + i), { state: "completed", at: 30 })));
      const reopened = await opened(root);
      for (let i = 0; i < 12; i++) {
        const entry = await reopened.get(identity("c" + i));
        expect(entry?.turnId).toBe("turn:c" + i);
        expect(entry?.startedAt).toBe(20);
        expect(entry?.state).toBe(i < 6 ? "completed" : "started");
        expect(entry?.receipt.stage).toBe("started");
      }
    });
  });

  test("return values cannot mutate the committed journal", async () => {
    await withDir(async (root) => {
      const ledger = await opened(root);
      const result = await ledger.reserve(reservation("copy"));
      result.state = "completed";
      result.receipt.stage = "started";
      const fetched = await ledger.get(identity("copy"));
      expect(fetched?.state).toBe("admitted");
      expect(fetched?.receipt.stage).toBe("acked-by-bridge");
    });
  });

  test("unknown outcomes and restarted starts require explicit reconciliation", async () => {
    await withDir(async (root) => {
      const ledger = await opened(root);
      await ledger.reserve(reservation("uncertain"));
      const unknown = await ledger.update(identity("uncertain"), { state: "unknown", at: 110 });
      expect(unknown.reconciliationRequired).toBe(true);
      await expect(ledger.update(identity("uncertain"), { state: "started", at: 120 }))
        .rejects.toBeInstanceOf(DeliveryLedgerConflictError);
      await expect(ledger.update(identity("uncertain"), { state: "completed", at: 120 }))
        .rejects.toBeInstanceOf(DeliveryLedgerConflictError);
      const recovered = await opened(root);
      expect((await recovered.get(identity("uncertain")))?.state).toBe("unknown");
      const verified = await recovered.update(identity("uncertain"), {
        state: "started", at: 120, reconciled: true,
      });
      expect(verified.reconciliationRequired).toBe(false);
      expect(verified.receipt.stage).toBe("started");
      await recovered.update(identity("uncertain"), { state: "completed", at: 130 });
      await expect(recovered.update(identity("uncertain"), { state: "started", at: 140 }))
        .rejects.toBeInstanceOf(DeliveryLedgerConflictError);
      await expect(recovered.update(identity("uncertain"), { state: "completed", at: 129 }))
        .rejects.toBeInstanceOf(DeliveryLedgerConflictError);

      const second = await recovered.reserve(reservation("crashed-start"));
      await recovered.update(identity("crashed-start"), { state: "started", at: 140 });
      const restart = await opened(root);
      expect((await restart.get(identity("crashed-start")))?.reconciliationRequired).toBe(true);
      await expect(restart.update(identity("crashed-start"), { state: "completed", at: 150 }))
        .rejects.toBeInstanceOf(DeliveryLedgerConflictError);
      expect((await restart.reserve(reservation("crashed-start", 999))).turnId).toBe(second.turnId);
      await restart.update(identity("crashed-start"), {
        state: "completed", at: 150, reconciled: true,
      });
      expect((await restart.get(identity("crashed-start")))?.reconciliationRequired).toBe(false);
    });
  });

  test("rejects invalid reservations and does not admit unreserved updates", async () => {
    await withDir(async (root) => {
      const ledger = await opened(root);
      await expect(ledger.reserve({ ...reservation("x"), fingerprint: "unhashed plaintext" }))
        .rejects.toBeInstanceOf(TypeError);
      await expect(ledger.reserve({ ...reservation("x"), at: Number.NaN }))
        .rejects.toBeInstanceOf(TypeError);
      await expect(ledger.reserve({ ...reservation("x"), principalId: "" }))
        .rejects.toBeInstanceOf(TypeError);
      await expect(ledger.update(identity("missing"), { state: "started", at: 100 }))
        .rejects.toBeInstanceOf(DeliveryLedgerConflictError);
      expect(await ledger.get(identity("x"))).toBeUndefined();
    });
  });

  test("truncated snapshot, unsupported version and unknown fields never become an empty ledger", async () => {
    await withDir(async (root) => {
      const ledger = await opened(root);
      await ledger.reserve(reservation("guard"));
      const path = join(root, LEDGER_FILENAME);
      const good = await fs.readFile(path, "utf8");

      for (const corruption of [
        good.slice(0, 24),
        JSON.stringify({ version: 2, records: [] }),
        good.replace('"reconciliationRequired":false', '"reconciliationRequired":false,"token":"must-not-store"'),
        good.replace('"clientId":"guard"', '"clientId":""'),
      ]) {
        await fs.writeFile(path, corruption);
        const failed = new DeliveryLedger({ root });
        await expect(failed.load()).rejects.toBeInstanceOf(DeliveryLedgerCorruptError);
        await expect(failed.get(identity("guard"))).rejects.toBeInstanceOf(DeliveryLedgerUnavailableError);
      }

      await fs.writeFile(path, good);
      const recovered = await opened(root);
      expect((await recovered.get(identity("guard")))?.turnId).toBe("turn:guard");
      await fs.unlink(path);
      await expect(recovered.load()).rejects.toBeInstanceOf(DeliveryLedgerCorruptError);
      await expect(recovered.get(identity("guard"))).rejects.toBeInstanceOf(DeliveryLedgerUnavailableError);
    });
  });

  test("read errors are propagated rather than treated as missing state", async () => {
    await withDir(async (root) => {
      const ledger = new DeliveryLedger({ root, filesystem: faultyFilesystem("read") });
      await expect(ledger.load()).rejects.toThrow("injected disk read error");
      await expect(ledger.reserve(reservation("unsafe"))).rejects.toBeInstanceOf(DeliveryLedgerUnavailableError);
    });
  });

  test("write and file-fsync errors never acknowledge or mutate old state", async () => {
    await withDir(async (root) => {
      const seed = await opened(root);
      await seed.reserve(reservation("persisted"));
      const faults: Fault[] = ["write", "file-sync"];
      for (const fault of faults) {
        const ledger = await opened(root, faultyFilesystem(fault));
        // Reloaded admissions require explicit host reconciliation; exercise
        // the actual disk error rather than short-circuiting at that guard.
        expect((await ledger.get(identity("persisted")))?.reconciliationRequired).toBe(true);
        await expect(ledger.update(identity("persisted"), {
          state: "started", at: 120, reconciled: true,
        })).rejects.toThrow("injected");
        expect((await ledger.get(identity("persisted")))?.state).toBe("admitted");
        await expect(ledger.reserve(reservation("new-" + fault)))
          .rejects.toThrow("injected");
        expect(await ledger.get(identity("new-" + fault))).toBeUndefined();
        const disk = await opened(root);
        expect((await disk.get(identity("persisted")))?.state).toBe("admitted");
        expect(await disk.get(identity("new-" + fault))).toBeUndefined();
      }
    });
  });

  test("uncertain rename and directory sync error poison instance until explicit disk recovery", async () => {
    await withDir(async (root) => {
      const initial = await opened(root);
      await initial.reserve(reservation("existing"));
      const faults: Fault[] = ["rename", "directory-sync"];
      for (const fault of faults) {
        const ledger = await opened(root, faultyFilesystem(fault));
        await expect(ledger.reserve(reservation("candidate-" + fault))).rejects.toThrow("injected");
        await expect(ledger.get(identity("existing"))).rejects.toBeInstanceOf(DeliveryLedgerUnavailableError);
        await expect(ledger.reserve(reservation("another"))).rejects.toBeInstanceOf(DeliveryLedgerUnavailableError);

        await ledger.load();
        expect((await ledger.get(identity("existing")))?.turnId).toBe("turn:existing");
        const candidate = await ledger.get(identity("candidate-" + fault));
        // Rename may or may not have committed. Neither result permits a
        // second start; a recovered admission is reconciliation-required.
        if (fault === "rename") {
          expect(candidate).toBeUndefined();
        } else {
          expect(candidate?.reconciliationRequired).toBe(true);
          expect(candidate?.receipt.stage).toBe("acked-by-bridge");
        }
      }
    });
  });

  test("terminal compaction retains unresolved entries across age and principal scope", async () => {
    await withDir(async (root) => {
      const ledger = await opened(root);
      await ledger.reserve(reservation("old-done", 10));
      await ledger.update(identity("old-done"), { state: "completed", at: 20 });
      await ledger.reserve(reservation("new-done", 60));
      await ledger.update(identity("new-done"), { state: "failed", at: 70 });
      await ledger.reserve(reservation("admitted", 1));
      await ledger.reserve(reservation("started", 2, "principal:beta"));
      await ledger.update(identity("started", "principal:beta"), { state: "started", at: 3 });
      await ledger.reserve(reservation("unknown", 4));
      await ledger.update(identity("unknown"), { state: "unknown", at: 5 });

      expect(await ledger.compact(50)).toBe(1);
      expect(await ledger.compact(50)).toBe(0);
      const recovered = await opened(root);
      expect(await recovered.get(identity("old-done"))).toBeUndefined();
      expect((await recovered.get(identity("new-done")))?.state).toBe("failed");
      expect((await recovered.get(identity("admitted")))?.reconciliationRequired).toBe(true);
      expect((await recovered.get(identity("started", "principal:beta")))?.reconciliationRequired).toBe(true);
      expect((await recovered.get(identity("unknown")))?.reconciliationRequired).toBe(true);
      expect(await recovered.compact(1000)).toBe(1);
      expect((await recovered.get(identity("unknown")))?.state).toBe("unknown");
      expect((await recovered.get(identity("started", "principal:beta")))?.state).toBe("started");
    });
  });

  test("capacity limits fail closed and leave the last durable snapshot intact", async () => {
    await withDir(async (root) => {
      const ledger = new DeliveryLedger({ root, maxEntries: 1 });
      await ledger.load();
      await ledger.reserve(reservation("one"));
      await expect(ledger.reserve(reservation("two"))).rejects.toBeInstanceOf(DeliveryLedgerCapacityError);
      await expect((await opened(root)).get(identity("one"))).resolves.toMatchObject({ turnId: "turn:one" });
      expect(await ledger.get(identity("two"))).toBeUndefined();
      const tooSmall = new DeliveryLedger({ root, maxBytes: 256 });
      await expect(tooSmall.load()).rejects.toBeInstanceOf(DeliveryLedgerCorruptError);
      expect(DEFAULT_LEDGER_MAX_ENTRIES).toBeGreaterThan(1);
    });
  });

  test("recovery validates duplicate principal-scoped keys and receipt consistency", async () => {
    await withDir(async (root) => {
      const seed = await opened(root);
      await seed.reserve(reservation("a"));
      const path = join(root, LEDGER_FILENAME);
      const raw = await fs.readFile(path, "utf8");
      const document: unknown = JSON.parse(raw);
      if (!isObject(document) || !Array.isArray(document.records)) throw new Error("invalid fixture");
      const first: unknown = document.records[0];
      if (!isObject(first) || !isObject(first.receipt)) throw new Error("invalid record fixture");
      await fs.writeFile(path, JSON.stringify({ version: 1, records: [first, first] }));
      await expect(new DeliveryLedger({ root }).load()).rejects.toBeInstanceOf(DeliveryLedgerCorruptError);
      await fs.writeFile(path, JSON.stringify({
        version: 1,
        records: [{ ...first, receipt: { ...first.receipt, turnId: "wrong-turn" } }],
      }));
      await expect(new DeliveryLedger({ root }).load()).rejects.toBeInstanceOf(DeliveryLedgerCorruptError);
      await fs.writeFile(path, raw);
      await expect((await opened(root)).get(identity("a"))).resolves.toMatchObject({
        turnId: "turn:a", reconciliationRequired: true,
      });
    });
  });
});
