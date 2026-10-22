import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSupervisionHttpHandler } from "./supervision-http";
import { groupKevinItems, parseKevinBatch } from "../../shared/supervision";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const item = { id: "worker-a", worker: "deleg_a/task-0", goal: "widget", why: "overdue", recommended_action: "resume", options: ["resume", "abandon", "integrated"], evidence_path: "/log", phase: "Overdue" };
const batch = { schema: "z0.fsm.needs-kevin/v1", generated_at: "2026-10-21T12:00:00Z", size: 1, items: [item] };
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "dash-supervision-")); dirs.push(directory);
  writeFileSync(join(directory, "needs-kevin.json"), JSON.stringify(batch));
  writeFileSync(join(directory, "state.json"), JSON.stringify({ generated_at: batch.generated_at, workers: [], findings: [] }));
  return { directory, handler: createSupervisionHttpHandler({ token: "test-only", directory }) };
}
const req = (method = "GET", token = "test-only", path = "/supervision") => new Request(`http://localhost${path}`, { method, headers: { Authorization: `Bearer ${token}` } });

test("pull-only authenticated endpoint, counts, grouping and no writes", async () => {
  const { directory, handler } = setup();
  const before = readFileSync(join(directory, "needs-kevin.json"), "utf8");
  expect((await handler(req("GET", "wrong")))?.status).toBe(401);
  expect((await handler(new Request("http://localhost/supervision?token=test-only")))?.status).toBe(401);
  expect((await handler(req("POST")))?.status).toBe(405);
  expect(await handler(req("GET", "test-only", "/elsewhere"))).toBeNull();
  const response = await handler(req());
  expect(response?.status).toBe(200);
  expect(response?.headers.get("cache-control")).toBe("no-store");
  const raw: unknown = await response?.json();
  const parsed = typeof raw === "object" && raw !== null && "needs_kevin" in raw ? parseKevinBatch(raw.needs_kevin) : null;
  expect(parsed?.size).toBe(1);
  expect(groupKevinItems(parsed?.items ?? [])[0]?.decision).toBe("resume");
  expect(readFileSync(join(directory, "needs-kevin.json"), "utf8")).toBe(before);
});

test("missing, malformed and mixed-generation snapshots are unavailable, not an empty queue", async () => {
  const { directory, handler } = setup();
  writeFileSync(join(directory, "state.json"), JSON.stringify({ generated_at: "other", workers: [], findings: [] }));
  expect((await handler(req()))?.status).toBe(503);
  writeFileSync(join(directory, "needs-kevin.json"), "{");
  expect((await handler(req()))?.status).toBe(503);
  rmSync(join(directory, "needs-kevin.json"));
  expect((await handler(req()))?.status).toBe(503);
});

test("parser rejects bad counts and duplicate ids", () => {
  expect(parseKevinBatch({ ...batch, size: 2 })).toBeNull();
  expect(parseKevinBatch({ ...batch, size: 2, items: [item, item] })).toBeNull();
  expect(parseKevinBatch({ ...batch, items: [{ ...item, options: [1] }] })).toBeNull();
});

test("real isolated HTTP server can read the batch", async () => {
  const { handler } = setup();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async request => await handler(request) ?? new Response(null, { status: 404 }) });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/supervision`, { headers: { Authorization: "Bearer test-only" } });
    expect(response.status).toBe(200);
    const raw: unknown = await response.json();
    const parsed = typeof raw === "object" && raw !== null && "needs_kevin" in raw ? parseKevinBatch(raw.needs_kevin) : null;
    expect(parsed?.size).toBe(1);
  } finally { server.stop(true); }
});
