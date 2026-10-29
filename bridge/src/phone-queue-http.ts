import type { PhoneQueueDevice, PhoneQueueJob, PhoneQueueSnapshot } from "../../shared/protocol";

/**
 * `GET /phones/queue`: a read-only view of the k3s phone queue (`/v1/devices`, `/v1/jobs`), so the
 * app never talks to the queue directly. The queue's schema is owned elsewhere, so fields are read
 * tolerantly and normalized; an unreachable or malformed queue is reported as `reachable: false`.
 */
export const DEFAULT_PHONE_QUEUE_URL = "http://100.113.138.100:8790";
const CACHE_MS = 5000;
const TIMEOUT_MS = 4000;
const MAX_ROWS = 200;

type Row = Record<string, unknown>;
function isRow(value: unknown): value is Row { return typeof value === "object" && value !== null && !Array.isArray(value); }
function pick(row: Row, keys: readonly string[]): unknown { for (const key of keys) if (row[key] !== undefined && row[key] !== null) return row[key]; return undefined; }
function text(row: Row, keys: readonly string[], max = 160): string | undefined {
  const value = pick(row, keys);
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, max);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}
function count(row: Row, keys: readonly string[]): number | undefined {
  const value = pick(row, keys);
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (Array.isArray(value)) return value.length;
  return undefined;
}
function percent(row: Row, keys: readonly string[]): number | undefined {
  const value = pick(row, keys);
  const raw = isRow(value) ? pick(value, ["percent", "pct", "level"]) : value;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return undefined;
  const pct = raw <= 1 && !Number.isInteger(raw) ? raw * 100 : raw;
  return pct <= 100 ? pct : undefined;
}
function time(row: Row, keys: readonly string[]): number | undefined {
  const value = pick(row, keys);
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value < 1e12 ? value * 1000 : value;
  if (typeof value === "string") { const at = Date.parse(value); return Number.isFinite(at) ? at : undefined; }
  return undefined;
}
function list(body: unknown, keys: readonly string[]): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (!isRow(body)) return null;
  for (const key of keys) { const value = body[key]; if (Array.isArray(value)) return value; }
  // `{ s22: {...}, s25: {...} }`: a map keyed by id.
  const entries = Object.entries(body).filter(([, value]) => isRow(value));
  return entries.length ? entries.map(([id, value]) => (isRow(value) ? { id, ...value } : value)) : null;
}

export function normalizeDevices(body: unknown): PhoneQueueDevice[] | null {
  const rows = list(body, ["devices", "items", "phones"]);
  if (!rows) return null;
  const devices: PhoneQueueDevice[] = [];
  for (const row of rows.slice(0, MAX_ROWS)) {
    if (!isRow(row)) continue;
    const id = text(row, ["id", "device", "name", "serial"]);
    if (!id) continue;
    const owner = pick(row, ["ownerActive", "owner_active", "owner_using", "ownerUsing"]);
    const batteryPct = percent(row, ["batteryPct", "battery_pct", "battery"]);
    const foreground = text(row, ["foreground", "foreground_app", "foregroundApp"]);
    const queued = count(row, ["queued", "queue_depth", "pending", "queue"]);
    const detail = text(row, ["detail", "reason", "note", "gate"]);
    devices.push({
      id, name: text(row, ["name", "label", "model", "id"]) ?? id,
      state: text(row, ["state", "status"], 40) ?? "unknown",
      ...(typeof owner === "boolean" ? { ownerActive: owner } : {}),
      ...(batteryPct !== undefined ? { batteryPct } : {}),
      ...(foreground ? { foreground } : {}), ...(queued !== undefined ? { queued } : {}), ...(detail ? { detail } : {}),
    });
  }
  return devices;
}

export function normalizeJobs(body: unknown): PhoneQueueJob[] | null {
  const rows = list(body, ["jobs", "items", "queue"]);
  if (!rows) return null;
  const jobs: PhoneQueueJob[] = [];
  for (const row of rows.slice(0, MAX_ROWS)) {
    if (!isRow(row)) continue;
    const id = text(row, ["id", "job_id", "jobId", "name"]);
    if (!id) continue;
    const device = text(row, ["device", "target", "serial", "phone"]);
    const kind = text(row, ["kind", "type", "app"], 40);
    const title = text(row, ["title", "summary", "prompt", "text"], 120);
    const agent = text(row, ["agent", "submitter", "requested_by", "requestedBy", "owner"], 60);
    const createdAt = time(row, ["createdAt", "created_at", "submitted_at", "enqueued_at"]);
    const updatedAt = time(row, ["updatedAt", "updated_at", "finished_at", "started_at"]);
    jobs.push({
      id, state: text(row, ["state", "status"], 40) ?? "unknown",
      ...(device ? { device } : {}), ...(kind ? { kind } : {}), ...(title ? { title } : {}), ...(agent ? { agent } : {}),
      ...(createdAt !== undefined ? { createdAt } : {}), ...(updatedAt !== undefined ? { updatedAt } : {}),
    });
  }
  return jobs;
}

export function createPhoneQueueHttpHandler(options: { authorize(request: Request): Promise<boolean>; baseUrl?: string; fetcher?: typeof fetch }) {
  const base = (options.baseUrl ?? process.env.DASH_PHONE_QUEUE_URL ?? DEFAULT_PHONE_QUEUE_URL).replace(/\/+$/, "");
  const fetcher = options.fetcher ?? fetch;
  let cache: PhoneQueueSnapshot | undefined;
  let pending: Promise<PhoneQueueSnapshot> | undefined;

  async function read(path: string): Promise<unknown> {
    const response = await fetcher(`${base}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
    return response.json();
  }

  async function load(): Promise<PhoneQueueSnapshot> {
    const fetchedAt = Date.now();
    const [devices, jobs] = await Promise.allSettled([read("/v1/devices"), read("/v1/jobs")]);
    const deviceRows = devices.status === "fulfilled" ? normalizeDevices(devices.value) : null;
    const jobRows = jobs.status === "fulfilled" ? normalizeJobs(jobs.value) : null;
    if (!deviceRows && !jobRows) {
      const reason = devices.status === "rejected" ? devices.reason : jobs.status === "rejected" ? jobs.reason : null;
      const error = reason instanceof Error ? (reason.name === "TimeoutError" ? "timed out" : reason.message) : "unexpected response";
      return { reachable: false, source: base, fetchedAt, devices: [], jobs: [], error: `Phone queue unreachable: ${error}`.slice(0, 200) };
    }
    return { reachable: true, source: base, fetchedAt, devices: deviceRows ?? [], jobs: jobRows ?? [],
      ...(!deviceRows ? { error: "Devices unavailable" } : !jobRows ? { error: "Jobs unavailable" } : {}) };
  }

  return async (request: Request): Promise<Response | null> => {
    if (new URL(request.url).pathname !== "/phones/queue") return null;
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
    if (!await options.authorize(request)) return json({ error: "unauthorized" }, 401);
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
    if (!cache || Date.now() - cache.fetchedAt >= CACHE_MS) {
      pending ??= load().finally(() => { pending = undefined; });
      cache = await pending;
    }
    return json(cache);
  };
}
