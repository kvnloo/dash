import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  buildReceipt,
  canonicalJson,
  verifyReceipt,
  type Receipt,
  type ReceiptInput,
} from "./receipt";

function sampleInput(): ReceiptInput {
  return {
    sha: "a".repeat(40),
    buildProfile: "release",
    deviceLabel: "Galaxy S25 Ultra",
    startedAt: "2026-10-27T15:00:00Z",
    finishedAt: "2026-10-27T15:02:00Z",
    rows: [
      { id: "local-ack", n: 100, p50: 17.1, p95: 28.5, status: "pass" },
      { id: "first-word", n: 100, p50: 222, p95: 450, status: "pass" },
    ],
    deviceState: [
      { batteryPct: 87, temperatureC: 32.4, thermalStatus: 0 },
      { batteryPct: 86, temperatureC: 33.2, thermalStatus: 1 },
    ],
    gates: { g0: true, g1: true, g2: true },
  };
}

function hashedReceipt(input: ReceiptInput): Receipt {
  return buildReceipt(input);
}

describe("canonicalJson", () => {
  test("sorts nested object keys and preserves ordered arrays without whitespace", () => {
    expect(canonicalJson({ z: 3, a: { y: [2, { z: 1, a: 0 }], x: true } }))
      .toBe('{"a":{"x":true,"y":[2,{"a":0,"z":1}]},"z":3}');
    expect(canonicalJson({ rows: ["a", "b"] }))
      .not.toBe(canonicalJson({ rows: ["b", "a"] }));
  });

  test("rejects non-finite numbers and values JSON would silently omit", () => {
    expect(() => canonicalJson({ p50: NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson({ p95: Infinity })).toThrow(/non-finite/);
    expect(() => canonicalJson({ missing: undefined })).toThrow(/undefined/);
    expect(() => canonicalJson({ callbacks: [() => "hidden"] })).toThrow(/unsupported/);
    expect(() => canonicalJson([1, undefined])).toThrow(/undefined/);
    expect(() => canonicalJson(1n)).toThrow(/unsupported/);
  });

  test("rejects holes, accessor fields and cycles instead of hashing incomplete data", () => {
    const holes: number[] = [];
    holes.length = 2;
    holes[0] = 7;
    expect(() => canonicalJson(holes)).toThrow(/sparse/);

    const accessor = Object.defineProperty({}, "secret", {
      enumerable: true,
      get: () => "private",
    });
    expect(() => canonicalJson(accessor)).toThrow(/accessor/);

    const recursive: { self?: unknown } = {};
    recursive.self = recursive;
    expect(() => canonicalJson(recursive)).toThrow(/circular/);
  });
});

describe("device-run receipts", () => {
  test("same input with shuffled object keys has identical digest and verified content", () => {
    const first = sampleInput();
    const reversed: ReceiptInput = {
      gates: { g2: true, g1: true, g0: true },
      deviceState: [
        { thermalStatus: 0, temperatureC: 32.4, batteryPct: 87 },
        { temperatureC: 33.2, thermalStatus: 1, batteryPct: 86 },
      ],
      rows: [
        { status: "pass", p95: 28.5, p50: 17.1, n: 100, id: "local-ack" },
        { p50: 222, status: "pass", id: "first-word", p95: 450, n: 100 },
      ],
      finishedAt: first.finishedAt,
      startedAt: first.startedAt,
      deviceLabel: first.deviceLabel,
      buildProfile: first.buildProfile,
      sha: first.sha,
    };
    const receipt = hashedReceipt(first);
    const same = hashedReceipt(reversed);
    expect(receipt.digest).toBe(same.digest);
    expect(receipt.verdict).toBe("pass");
    expect(verifyReceipt(receipt)).toEqual({ ok: true });

    const { digest, ...payload } = receipt;
    expect(digest).toBe(
      createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex"),
    );
    const jsonRoundTrip: unknown = JSON.parse(canonicalJson(receipt));
    expect(verifyReceipt(jsonRoundTrip)).toEqual({ ok: true });
  });

  test("a changed row after building fails verification, even when other fields are untouched", () => {
    const receipt = hashedReceipt(sampleInput());
    const row = receipt.rows[0];
    if (!row) throw new Error("fixture row missing");
    row.p95 = 999.5;
    expect(verifyReceipt(receipt)).toEqual({
      ok: false, reason: "digest: canonical JSON SHA-256 mismatch",
    });
  });

  test("one insufficient-n row or one false gate fails the verdict", () => {
    const few = sampleInput();
    few.rows = [{ id: "local-ack", n: 99, p50: 18, p95: 30, status: "insufficient-n" }];
    expect(hashedReceipt(few).verdict).toBe("fail");
    expect(verifyReceipt(hashedReceipt(few))).toEqual({ ok: true });

    const denied = sampleInput();
    denied.gates.g1 = false;
    const receipt = hashedReceipt(denied);
    expect(receipt.verdict).toBe("fail");
    expect(verifyReceipt(receipt)).toEqual({ ok: true });

    const noEvidence = sampleInput();
    noEvidence.rows = [];
    expect(hashedReceipt(noEvidence).verdict).toBe("fail");
  });

  test("forged verdict is refused even when an attacker recalculates the digest", () => {
    const receipt = hashedReceipt(sampleInput());
    const payload = { ...receipt, gates: { g0: false, g1: true, g2: true } };
    const { digest: oldDigest, ...unsigned } = payload;
    expect(oldDigest).toHaveLength(64);
    const modified = {
      ...unsigned,
      digest: createHash("sha256").update(canonicalJson(unsigned)).digest("hex"),
    };
    expect(verifyReceipt(modified)).toEqual({
      ok: false, reason: "verdict: inconsistent with rows or gates",
    });
  });

  test("receipt binds the full build SHA and does not alias caller arrays", () => {
    const source = sampleInput();
    const receipt = hashedReceipt(source);
    const row = source.rows[0];
    const state = source.deviceState[0];
    if (!row || !state) throw new Error("fixture missing row or state");
    row.p95 = 1000;
    state.batteryPct = 1;
    expect(verifyReceipt(receipt)).toEqual({ ok: true });
    expect(receipt.rows[0]?.p95).toBe(28.5);
    expect(receipt.deviceState[0]?.batteryPct).toBe(87);

    const wrongSha = sampleInput();
    wrongSha.sha = "short";
    expect(() => hashedReceipt(wrongSha)).toThrow(/sha/);
  });

  test("rejects bad measurements and malformed digest, not just changed payloads", () => {
    const invalid = sampleInput();
    invalid.rows = [{ id: "first-word", n: 100, p50: NaN, p95: 10, status: "pass" }];
    expect(() => hashedReceipt(invalid)).toThrow(/rows\[0\]\.p50/);

    const empty = sampleInput();
    empty.rows = [{ id: "local-ack", n: 0, p50: null, p95: null, status: "no-samples" }];
    expect(hashedReceipt(empty).verdict).toBe("fail");
    expect(verifyReceipt(hashedReceipt(empty))).toEqual({ ok: true });

    const malformed = { ...hashedReceipt(sampleInput()), digest: "0".repeat(64) };
    expect(verifyReceipt(malformed).ok).toBe(false);
    const unknown = { ...hashedReceipt(sampleInput()), extra: "pass" };
    expect(verifyReceipt(unknown)).toEqual({
      ok: false, reason: "receipt.extra: unexpected field",
    });
  });
});

describe("privacy guard", () => {
  test("rejects address-like string at its offending nested key", () => {
    const input = sampleInput();
    input.rows = [{ id: "10.20.30.40", n: 100, p50: 10, p95: 20, status: "pass" }];
    expect(() => hashedReceipt(input)).toThrow(/rows\[0\]\.id: address-like/);

    const raw = {
      ...hashedReceipt(sampleInput()),
      deviceState: [{ batteryPct: 70, temperatureC: 35, thermalStatus: 1, source: "192.168.0.15" }],
    };
    expect(verifyReceipt(raw)).toEqual({
      ok: false,
      reason: "deviceState[0].source: address-like string prohibited",
    });
  });

  test("rejects absolute path in any string field, including unexpected nested fields", () => {
    const input = sampleInput();
    input.rows = [{ id: "/data/local/tmp", n: 100, p50: 10, p95: 20, status: "pass" }];
    expect(() => hashedReceipt(input)).toThrow(/rows\[0\]\.id: absolute path/);

    const raw = { ...hashedReceipt(sampleInput()), collector: { artifact: "/sdcard/trace.json" } };
    expect(verifyReceipt(raw)).toEqual({
      ok: false,
      reason: "collector.artifact: absolute path prohibited",
    });
  });

  test("rejects serial-like long alphanumeric strings, preserving the SHA and digest fields", () => {
    const input = sampleInput();
    input.deviceLabel = "Galaxy SerialABC123456";
    expect(() => hashedReceipt(input)).toThrow(/deviceLabel: long alphanumeric/);

    const nested = {
      ...hashedReceipt(sampleInput()),
      rows: [{ id: "serialA123456", n: 100, p50: 10, p95: 20, status: "pass" }],
    };
    expect(verifyReceipt(nested)).toEqual({
      ok: false, reason: "rows[0].id: long alphanumeric identifier prohibited",
    });

    expect(verifyReceipt(hashedReceipt(sampleInput()))).toEqual({ ok: true });
  });

  test("deviceLabel must contain only model characters and be no more than 32 chars", () => {
    const input = sampleInput();
    input.deviceLabel = "S25 Ultra (serial)";
    expect(() => hashedReceipt(input)).toThrow(/deviceLabel/);
    input.deviceLabel = "Pixel 9 Pro Pixel 9 Pro Pixel 9 Pro";
    expect(() => hashedReceipt(input)).toThrow(/deviceLabel: expected model label of at most 32/);
    input.deviceLabel = "Pixel 9 Pro+";
    expect(verifyReceipt(hashedReceipt(input))).toEqual({ ok: true });
  });
});
