import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseServerMessage, type NoticeMessage } from "../../../shared/protocol";
import { createAgentNoticeInbox } from "./agent-notices";
import type { DashNotice } from "./notification-policy";

test("composed bridge: authenticated ingress broadcasts, offline reports replay with app dedupe", async () => {
  const root = mkdtempSync(join(tmpdir(), "dash-notice-entry-"));
  const sockets: WebSocket[] = [];
  const proc = Bun.spawn([process.execPath, resolve(import.meta.dir, "../../../bridge/index.ts")], {
    env: { ...process.env, DASH_HOST: "127.0.0.1", DASH_ALLOW_LOOPBACK: "1", DASH_PORT: "0", DASH_NOTICE_PORT: "0", DASH_CREDENTIAL_DIR: join(root, "credentials"), DASH_HERMES_ROOT: join(root, "hermes"), DASH_Z0LIVE_SESSIONS: join(root, "z0live"), DASH_STT_MODEL: join(root, "no-model"), DASH_CHAT_INDEX: join(root, "index.db"), DASH_AGENTSVIEW_DB: join(root, "missing.db"), DASH_GATE_ENABLED: "0" },
    stdout: "ignore", stderr: "pipe",
  });
  let log = "";
  const reading = (async () => { for await (const chunk of proc.stderr) log += new TextDecoder().decode(chunk); })();
  async function until(check: () => boolean) {
    for (let i = 0; i < 400; i++) { if (check()) return; await Bun.sleep(20); }
    throw new Error("notice bridge condition timed out");
  }
  try {
    await until(() => /dash bridge\s+ws:\/\/127\.0\.0\.1:(\d+)/.test(log) && /notices\s+http:\/\/127\.0\.0\.1:(\d+)/.test(log));
    const port = Number(/dash bridge\s+ws:\/\/127\.0\.0\.1:(\d+)/.exec(log)?.[1]);
    const noticePort = Number(/notices\s+http:\/\/127\.0\.0\.1:(\d+)/.exec(log)?.[1]);
    const token = readFileSync(join(root, "credentials/token"), "utf8").trim();
    const post = (body: string, auth = token, target = noticePort) => fetch(`http://127.0.0.1:${target}/notice`, { method: "POST", headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" }, body: JSON.stringify({ title: "Report", body }) });
    expect((await post("denied", "wrong")).status).toBe(401);
    expect((await post("denied", token, port)).status).toBe(403);
    const emitted: DashNotice[] = [];
    const inbox = createAgentNoticeInbox({ emit: n => { emitted.push(n); } });
    async function connect() {
      const received: NoticeMessage[] = []; let hello = false;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`); sockets.push(ws);
      ws.onmessage = e => {
        const message = parseServerMessage(JSON.parse(String(e.data)));
        if (message?.type === "hello") hello = true;
        if (message?.type === "notice") { received.push(message); void inbox.receive(message); }
      };
      await until(() => hello);
      return { ws, received };
    }
    const a = await connect(); const b = await connect();
    const first = await post("online"); expect(first.status).toBe(201);
    const one = parseServerMessage(await first.json()); expect(one?.type).toBe("notice");
    if (one?.type !== "notice") throw new Error("Expected an accepted notice");
    await until(() => a.received.length === 1 && b.received.length === 1 && emitted.length === 1);
    expect(a.received[0]).toEqual(one); expect(b.received[0]).toEqual(one);
    a.ws.close(); b.ws.close();
    await until(() => a.ws.readyState === WebSocket.CLOSED && b.ws.readyState === WebSocket.CLOSED);
    expect((await post("while offline")).status).toBe(201);
    const c = await connect(); await until(() => c.received.length === 2 && emitted.length === 2);
    expect(inbox.list().map(n => n.body)).toEqual(["while offline", "online"]);
    c.ws.close();
    const d = await connect(); await until(() => d.received.length === 2);
    await inbox.hydrate(); expect(emitted).toHaveLength(2);
  } finally {
    for (const ws of sockets) ws.close();
    proc.kill("SIGTERM"); await proc.exited; await reading;
    rmSync(root, { recursive: true, force: true });
  }
}, 20000);
