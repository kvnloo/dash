import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NoticeService, createNoticeHttpHandler, startNoticeServer, tryStartNoticeServer } from "./notices";
import type { NoticeMessage } from "../../shared/protocol";
const roots: string[] = [];
function service() { const root = mkdtempSync(join(tmpdir(), "dash-notices-")); roots.push(root); return { root, notices: new NoticeService(root) }; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const token = "test-only-execution-token";
const payload = { title: "Ready", body: "Done", url: "dash://notices" };
function request(auth = token, body = JSON.stringify(payload), headers = {}) { return new Request("http://127.0.0.1/notice", { method: "POST", headers: { authorization: `Bearer ${auth}`, "content-type": "application/json", ...headers }, body }); }
test("refuses missing/wrong/absent configured token, non-loopback peers and browser origins", async () => {
  const { notices } = service();
  const handle = createNoticeHttpHandler({ token, notices });
  for (const auth of ["", "wrong"]) expect((await handle(request(auth), "127.0.0.1")).status).toBe(401);
  expect((await createNoticeHttpHandler({ token: "", notices })(request(), "127.0.0.1")).status).toBe(401);
  for (const ip of [null, "100.64.0.1", "192.168.1.2"]) expect((await handle(request(), ip)).status).toBe(403);
  expect((await handle(request(token, undefined, { origin: "https://evil.test" }), "127.0.0.1")).status).toBe(403);
  expect(notices.list()).toEqual([]);
});
test("bounded input, methods, rate window and disk-before-broadcast", async () => {
  const { notices, root } = service(); let now = 1;
  let handle = createNoticeHttpHandler({ token, notices, now: () => now });
  expect((await handle(new Request("http://localhost/notice", { headers: { authorization: `Bearer ${token}` } }), "127.0.0.1")).status).toBe(405);
  expect((await handle(request(token, "{"), "127.0.0.1")).status).toBe(400);
  expect((await handle(request(token, JSON.stringify({ title: "x".repeat(81), body: "b" })), "127.0.0.1")).status).toBe(400);
  expect((await handle(request(token, "x".repeat(8193)), "127.0.0.1")).status).toBe(413);
  const seen: NoticeMessage[] = [];
  handle = createNoticeHttpHandler({ token, notices, now: () => now });
  const stop = notices.subscribe(n => { expect(readFileSync(join(root, "notices.json"), "utf8")).toContain(n.id); seen.push(n); });
  for (let i = 0; i < 10; i++) expect((await handle(request(), "::1")).status).toBe(201);
  const limited = await handle(request(), "127.0.0.1"); expect(limited.status).toBe(429); expect(limited.headers.get("retry-after")).toBe("60");
  expect(seen).toHaveLength(10); now += 60000;
  expect((await handle(request(), "127.0.0.1")).status).toBe(201); stop();
});
test("last 50 survive restart; reconnect replay retains stable ids", () => {
  const { notices, root } = service();
  for (let i = 0; i < 55; i++) notices.publish({ title: `Report ${i}`, body: "body" });
  expect(notices.list()).toHaveLength(50); expect(notices.list()[0]?.title).toBe("Report 5");
  const ids = new Set<string>(); const receive = (n: NoticeMessage) => ids.add(n.id);
  const stop = notices.subscribe(receive); stop();
  const restored = new NoticeService(root); const stopAgain = restored.subscribe(receive);
  expect(ids.size).toBe(50); restored.publish(payload); expect(ids.size).toBe(51); stopAgain();
});
test("real loopback listener accepts CLI and never binds tailnet", async () => {
  const { notices, root } = service(); const server = startNoticeServer({ token, notices, port: 0 });
  try {
    expect(server.hostname).toBe("127.0.0.1");
    const { writeFileSync } = await import("node:fs"); writeFileSync(join(root, "token"), token);
    const run = (args: string[], env = {}) => Bun.spawn([process.execPath, "bridge/bin/dash-notify", ...args], { cwd: join(import.meta.dir, "../.."), env: { ...process.env, DASH_CREDENTIAL_DIR: root, DASH_NOTICE_PORT: String(server.port), ...env }, stdout: "pipe", stderr: "pipe" });
    const ok = run(["CLI ready", "CLI report", "--url", "dash://notices"]); expect(await ok.exited).toBe(0);
    expect(notices.list()[0]?.title).toBe("CLI ready");
    const bad = run(["Only title"]); expect(await bad.exited).toBe(2);
    const unauthorized = run(["T", "B"], { DASH_CREDENTIAL_DIR: join(root, "missing") }); expect(await unauthorized.exited).toBe(1);
    expect(await new Response(unauthorized.stderr).text()).not.toContain(token);
  } finally { server.stop(true); }
});
test("corrupt history is quarantined, not fatal; the bridge keeps a fresh ring", async () => {
  const root = mkdtempSync(join(tmpdir(), "dash-notices-")); roots.push(root);
  const { writeFileSync, readdirSync, statSync } = await import("node:fs");
  for (const corrupt of ["{not json", JSON.stringify({ not: "array" }), JSON.stringify([{ type: "notice" }])]) {
    writeFileSync(join(root, "notices.json"), corrupt);
    const notices = new NoticeService(root);
    expect(notices.list()).toEqual([]);
    expect(notices.quarantined).toMatch(/notices\.json\.corrupt-/);
    expect(readFileSync(notices.quarantined ?? "", "utf8")).toBe(corrupt);
    expect(statSync(notices.quarantined ?? "").mode & 0o777).toBe(0o600);
    notices.publish(payload); expect(new NoticeService(root).list()).toHaveLength(1);
    for (const f of readdirSync(root)) rmSync(join(root, f));
  }
});
test("clear empties the ring on disk so reconnect replays nothing", () => {
  const { notices, root } = service();
  notices.publish(payload); notices.publish(payload);
  notices.clear();
  expect(notices.list()).toEqual([]);
  expect(new NoticeService(root).list()).toEqual([]);
  const replayed: NoticeMessage[] = []; notices.subscribe(n => { replayed.push(n); }); expect(replayed).toEqual([]);
});
test("a taken notice port does not throw; the bridge runs without notices", () => {
  const { notices } = service();
  const holder = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("busy") });
  const errors: string[] = [];
  try {
    const server = tryStartNoticeServer({ token, notices, port: holder.port ?? 0 }, message => { errors.push(message); });
    expect(server).toBeNull();
    expect(errors).toHaveLength(1); expect(errors[0]).not.toContain(token);
    const ok = tryStartNoticeServer({ token, notices, port: 0 }, message => { errors.push(message); });
    expect(ok?.port).toBeGreaterThan(0); ok?.stop(true);
  } finally { holder.stop(true); }
});
test("publish reports how many live sockets received it, so the bridge log can confirm delivery", () => {
  const root = mkdtempSync(join(tmpdir(), "dash-notices-")); roots.push(root);
  const published: Array<[string, number]> = [];
  const notices = new NoticeService(root, (n, delivered) => { published.push([n.id, delivered]); });
  const a = notices.subscribe(() => {}); notices.subscribe(() => { throw new Error("dead socket"); });
  const first = notices.publish(payload);
  a(); const second = notices.publish(payload);
  expect(published).toEqual([[first.id, 1], [second.id, 0]]);
});
