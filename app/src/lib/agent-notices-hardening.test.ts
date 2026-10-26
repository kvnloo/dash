import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseServerMessage, type NoticeMessage } from "../../../shared/protocol";

/** Real bridge process: notice failures must degrade, never take the chat bridge down. */
async function withBridge(setup: (credentials: string) => Record<string, string>, run: (ctx: { log: () => string; port: number; token: string; credentials: string; until: (check: () => boolean) => Promise<void> }) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "dash-notice-hard-"));
  const credentials = join(root, "credentials"); mkdirSync(credentials, { recursive: true, mode: 0o700 });
  const extra = setup(credentials);
  const proc = Bun.spawn([process.execPath, resolve(import.meta.dir, "../../../bridge/index.ts")], {
    env: { ...process.env, DASH_HOST: "127.0.0.1", DASH_ALLOW_LOOPBACK: "1", DASH_PORT: "0", DASH_NOTICE_PORT: "0", DASH_CREDENTIAL_DIR: credentials, DASH_HERMES_ROOT: join(root, "hermes"), DASH_Z0LIVE_SESSIONS: join(root, "z0live"), DASH_STT_MODEL: join(root, "no-model"), DASH_CHAT_INDEX: join(root, "index.db"), DASH_AGENTSVIEW_DB: join(root, "missing.db"), DASH_GATE_ENABLED: "0", ...extra },
    stdout: "ignore", stderr: "pipe",
  });
  let log = "";
  const reading = (async () => { for await (const chunk of proc.stderr) log += new TextDecoder().decode(chunk); })();
  let exited = false; void proc.exited.then(() => { exited = true; });
  async function until(check: () => boolean) {
    for (let i = 0; i < 400; i++) { if (check()) return; if (exited) throw new Error(`bridge exited:\n${log}`); await Bun.sleep(20); }
    throw new Error(`condition timed out:\n${log}`);
  }
  try {
    await until(() => /dash bridge\s+ws:\/\/127\.0\.0\.1:(\d+)/.test(log));
    const port = Number(/dash bridge\s+ws:\/\/127\.0\.0\.1:(\d+)/.exec(log)?.[1]);
    const token = readFileSync(join(credentials, "token"), "utf8").trim();
    await run({ log: () => log, port, token, credentials, until });
  } finally {
    proc.kill("SIGTERM"); await proc.exited; await reading;
    rmSync(root, { recursive: true, force: true });
  }
}

async function connect(port: number, token: string, until: (check: () => boolean) => Promise<void>) {
  const received: NoticeMessage[] = []; let hello = false;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
  ws.onmessage = e => {
    const message = parseServerMessage(JSON.parse(String(e.data)));
    if (message?.type === "hello") hello = true;
    if (message?.type === "notice") received.push(message);
  };
  await until(() => hello);
  return { ws, received };
}

test("taken notice port and corrupt history: bridge still serves chat, history is quarantined", async () => {
  const holder = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("busy") });
  try {
    await withBridge(credentials => {
      writeFileSync(join(credentials, "notices.json"), "{corrupt", { mode: 0o600 });
      return { DASH_NOTICE_PORT: String(holder.port) };
    }, async ({ log, port, token, credentials, until }) => {
      await until(() => /notices\s+disabled/.test(log()));
      expect(log()).not.toContain(token);
      expect(readdirSync(credentials).some(f => f.startsWith("notices.json.corrupt-"))).toBe(true);
      const c = await connect(port, token, until); c.ws.close();
    });
  } finally { holder.stop(true); }
}, 20000);

test("notices_clear from the phone empties the bridge ring", async () => {
  await withBridge(() => ({}), async ({ log, port, token, until }) => {
    await until(() => /notices\s+http:\/\/127\.0\.0\.1:(\d+)/.test(log()));
    const noticePort = Number(/notices\s+http:\/\/127\.0\.0\.1:(\d+)/.exec(log())?.[1]);
    const post = () => fetch(`http://127.0.0.1:${noticePort}/notice`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ title: "Report", body: "kept?" }) });
    expect((await post()).status).toBe(201);
    const a = await connect(port, token, until); await until(() => a.received.length === 1);
    a.ws.send(JSON.stringify({ type: "notices_clear" }));
    await until(() => /notices\.cleared/.test(log()));
    a.ws.close();
    const b = await connect(port, token, until); await Bun.sleep(200);
    expect(b.received).toEqual([]); b.ws.close();
  });
}, 20000);
