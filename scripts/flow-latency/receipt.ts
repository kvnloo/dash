/**
 * Deterministic, public-safe device-run evidence for the Flow latency gates.
 *
 * This is tamper evidence, not an authenticity signature. The device runner
 * supplies the build SHA, measurements and state; this module does not capture
 * a device, read files, use a clock, or sign anything.
 */
import { createHash } from "node:crypto";

export type ReceiptRow = {
  id: string;
  n: number;
  p50: number | null;
  p95: number | null;
  status: "pass" | "fail" | "insufficient-n" | "no-samples";
};

export type ReceiptDeviceState = {
  batteryPct: number;
  temperatureC: number;
  thermalStatus: number;
};

export type ReceiptInput = {
  sha: string;
  buildProfile: "dev" | "release";
  deviceLabel: string;
  startedAt: string;
  finishedAt: string;
  rows: ReceiptRow[];
  deviceState: ReceiptDeviceState[];
  gates: { g0: boolean; g1: boolean; g2: boolean };
};

export type Receipt = ReceiptInput & {
  verdict: "pass" | "fail";
  digest: string;
};

export type ReceiptVerification =
  | { ok: true }
  | { ok: false; reason: string };

const INPUT_KEYS = [
  "sha", "buildProfile", "deviceLabel", "startedAt", "finishedAt",
  "rows", "deviceState", "gates",
];
const RECEIPT_KEYS = [...INPUT_KEYS, "verdict", "digest"];
const ROW_KEYS = ["id", "n", "p50", "p95", "status"];
const DEVICE_KEYS = ["batteryPct", "temperatureC", "thermalStatus"];
const GATE_KEYS = ["g0", "g1", "g2"];
const ADDRESS = /(?:^|[^0-9])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?=$|[^0-9])/;
const LONG_ID = /[A-Za-z0-9]{10,}/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype &&
       Object.getPrototypeOf(value) !== null)) {
    throw new Error(path + ": expected plain object");
  }
  return value;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new Error(path + "." + key + ": missing field");
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(path + "." + key + ": unexpected field");
  }
}

function textField(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(path + ": expected nonempty string");
  }
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(path + ": expected finite number");
  }
  return value;
}

function percentileValue(value: unknown, path: string): number | null {
  if (value === null) return null;
  const number = finiteNumber(value, path);
  if (number < 0) throw new Error(path + ": latency must be nonnegative");
  return number;
}

/**
 * Privacy is checked for every nested string, including unknown extra fields.
 * SHA and digest are the only exceptions to the long-ID rule. "insufficient-n"
 * is the established budget evaluator status, not a captured device identifier.
 */
function checkPrivacy(value: unknown, path = "", seen = new WeakSet<object>()): void {
  if (typeof value === "string") {
    if (ADDRESS.test(value)) throw new Error(path + ": address-like string prohibited");
    if (value.trimStart().startsWith("/")) throw new Error(path + ": absolute path prohibited");
    if (path !== "sha" && path !== "digest" &&
        !(path.endsWith(".status") && value === "insufficient-n") &&
        LONG_ID.test(value)) {
      throw new Error(path + ": long alphanumeric identifier prohibited");
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new Error((path || "receipt") + ": circular value");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        checkPrivacy(value[i], path + "[" + i + "]", seen);
      }
    } else if (isRecord(value)) {
      for (const [key, child] of Object.entries(value)) {
        checkPrivacy(child, path ? path + "." + key : key, seen);
      }
    }
  } finally {
    seen.delete(value);
  }
}

/** Stable JSON: key-sort at every depth, preserve array order, never omit data. */
export function canonicalJson(value: unknown): string {
  const seen = new WeakSet<object>();

  function write(current: unknown, path: string): string {
    if (current === null) return "null";
    if (typeof current === "string" ||
        typeof current === "boolean" ||
        typeof current === "number") {
      if (typeof current === "number" && !Number.isFinite(current)) {
        throw new Error(path + ": non-finite number");
      }
      const encoded = JSON.stringify(current);
      if (encoded === undefined) throw new Error(path + ": not JSON-serializable");
      return encoded;
    }
    if (typeof current !== "object") {
      throw new Error(path + ": unsupported or undefined JSON value");
    }
    if (seen.has(current)) throw new Error(path + ": circular JSON value");
    seen.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.getOwnPropertyNames(current).length !== current.length + 1 ||
            Object.getOwnPropertySymbols(current).length !== 0) {
          throw new Error(path + ": sparse array or extra array property");
        }
        const parts: string[] = [];
        for (let index = 0; index < current.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          if (!descriptor || !("value" in descriptor)) {
            throw new Error(path + "[" + index + "]: array hole or accessor");
          }
          const child: unknown = descriptor.value;
          parts.push(write(child, path + "[" + index + "]"));
        }
        return "[" + parts.join(",") + "]";
      }
      const object = record(current, path);
      if (Object.getOwnPropertySymbols(object).length !== 0) {
        throw new Error(path + ": symbol-keyed object");
      }
      const parts: string[] = [];
      for (const key of Object.getOwnPropertyNames(object).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          throw new Error(path + "." + key + ": hidden field or accessor");
        }
        const child: unknown = descriptor.value;
        parts.push(JSON.stringify(key) + ":" + write(child, path + "." + key));
      }
      return "{" + parts.join(",") + "}";
    } finally {
      seen.delete(current);
    }
  }

  return write(value, "$");
}

function parseRow(raw: unknown, path: string): ReceiptRow {
  const item = record(raw, path);
  exactKeys(item, ROW_KEYS, path);
  const id = textField(item.id, path + ".id");
  const n = finiteNumber(item.n, path + ".n");
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(path + ".n: expected nonnegative safe integer");
  }
  const p50 = percentileValue(item.p50, path + ".p50");
  const p95 = percentileValue(item.p95, path + ".p95");
  if (p50 !== null && p95 !== null && p50 > p95) {
    throw new Error(path + ".p50: exceeds p95");
  }
  const status = item.status;
  if (status !== "pass" && status !== "fail" &&
      status !== "insufficient-n" && status !== "no-samples") {
    throw new Error(path + ".status: unknown budget status");
  }
  if ((n === 0) !== (status === "no-samples")) {
    throw new Error(path + ".status: inconsistent with sample count");
  }
  if (status === "pass" && (p50 === null || p95 === null)) {
    throw new Error(path + ".status: pass requires measured percentiles");
  }
  return { id, n, p50, p95, status };
}

function parseDevice(raw: unknown, path: string): ReceiptDeviceState {
  const device = record(raw, path);
  exactKeys(device, DEVICE_KEYS, path);
  const batteryPct = finiteNumber(device.batteryPct, path + ".batteryPct");
  const temperatureC = finiteNumber(device.temperatureC, path + ".temperatureC");
  const thermalStatus = finiteNumber(device.thermalStatus, path + ".thermalStatus");
  if (batteryPct < 0 || batteryPct > 100) {
    throw new Error(path + ".batteryPct: out of range");
  }
  if (!Number.isInteger(thermalStatus) || thermalStatus < 0 || thermalStatus > 6) {
    throw new Error(path + ".thermalStatus: expected Android status 0..6");
  }
  return { batteryPct, temperatureC, thermalStatus };
}

function parseFields(value: Record<string, unknown>): ReceiptInput {
  const sha = textField(value.sha, "sha");
  if (!/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(sha)) {
    throw new Error("sha: expected full Git commit SHA");
  }
  const buildProfile = value.buildProfile;
  if (buildProfile !== "dev" && buildProfile !== "release") {
    throw new Error("buildProfile: expected dev or release");
  }
  const deviceLabel = textField(value.deviceLabel, "deviceLabel");
  if (deviceLabel.length > 32 || !/^[A-Za-z0-9 +-]+$/.test(deviceLabel)) {
    throw new Error("deviceLabel: expected model label of at most 32 letters/digits/spaces/+/-");
  }
  const startedAt = textField(value.startedAt, "startedAt");
  const finishedAt = textField(value.finishedAt, "finishedAt");
  if (!Array.isArray(value.rows)) throw new Error("rows: expected array");
  if (!Array.isArray(value.deviceState)) throw new Error("deviceState: expected array");
  const rows: ReceiptRow[] = value.rows.map(
    (item: unknown, index: number) => parseRow(item, "rows[" + index + "]"),
  );
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error("rows: duplicate id " + row.id);
    ids.add(row.id);
  }
  const deviceState: ReceiptDeviceState[] = value.deviceState.map(
    (item: unknown, index: number) => parseDevice(item, "deviceState[" + index + "]"),
  );
  const gates = record(value.gates, "gates");
  exactKeys(gates, GATE_KEYS, "gates");
  const g0 = gates.g0;
  const g1 = gates.g1;
  const g2 = gates.g2;
  if (typeof g0 !== "boolean" || typeof g1 !== "boolean" || typeof g2 !== "boolean") {
    throw new Error("gates: g0, g1 and g2 must be booleans");
  }
  return {
    sha, buildProfile, deviceLabel, startedAt, finishedAt,
    rows, deviceState, gates: { g0, g1, g2 },
  };
}

function parseInput(raw: unknown): ReceiptInput {
  checkPrivacy(raw);
  const input = record(raw, "receipt");
  exactKeys(input, INPUT_KEYS, "receipt");
  return parseFields(input);
}

function verdictFor(input: ReceiptInput): "pass" | "fail" {
  return input.rows.length > 0 && input.deviceState.length > 0 &&
    input.rows.every((row) => row.status === "pass") &&
    input.gates.g0 && input.gates.g1 && input.gates.g2 ? "pass" : "fail";
}

function hash(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

export function buildReceipt(input: ReceiptInput): Receipt {
  const clean = parseInput(input);
  const payload = { ...clean, verdict: verdictFor(clean) };
  return { ...payload, digest: hash(payload) };
}

export function verifyReceipt(raw: unknown): ReceiptVerification {
  try {
    checkPrivacy(raw);
    const fields = record(raw, "receipt");
    exactKeys(fields, RECEIPT_KEYS, "receipt");
    const input = parseFields(fields);
    const verdict = fields.verdict;
    if (verdict !== "pass" && verdict !== "fail") {
      throw new Error("verdict: expected pass or fail");
    }
    const digest = textField(fields.digest, "digest");
    if (!/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error("digest: expected lowercase SHA-256 hex");
    }
    const payload = { ...input, verdict };
    if (verdict !== verdictFor(input)) {
      return { ok: false, reason: "verdict: inconsistent with rows or gates" };
    }
    if (hash(payload) !== digest) {
      return { ok: false, reason: "digest: canonical JSON SHA-256 mismatch" };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "invalid receipt",
    };
  }
}
