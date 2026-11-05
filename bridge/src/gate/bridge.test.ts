import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GateStore } from "./store";
import { proposal, rules } from "./store.test";
import { parseServerMessage, type ServerMessage } from "../../../shared/protocol";

test("paired bridge lists, subscribes and persists owner bulk/edit/reject; rejects anonymous", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gate-bridge-"));
  const store = new GateStore(join(dir, "gate"));
  const a = await store.propose(proposal(), rules);
  const b = await store.propose({ ...proposal(), body: "Second" }, rules);
  const c = await store.propose({ ...proposal(), target: { repo: "example/project", number: 13 } }, [{ path: "CONTRIBUTING.md", text: "No AI-generated comments" }]);
  const proc = Bun.spawn([process.execPath, resolve(import.meta.dir, "../../index.ts")], {
    env: { ...process.env, DASH_HOST: "127.0.0.1", DASH_ALLOW_LOOPBACK: "1", DASH_PORT: "0", DASH_CREDENTIAL_DIR: join(dir, "credentials"), DASH_GATE_DIR: store.root, DASH_GATE_ENABLED: "1", DASH_GATE_LIVE: "0", DASH_STT_MODEL: join(dir, "no-model") },
    stdout: "ignore", stderr: "pipe",
  });
  let port = 0;
  const reading = (async () => { for await (const chunk of proc.stderr) { const m = /dash bridge\s+ws:\/\/127\.0\.0\.1:(\d+)/.exec(new TextDecoder().decode(chunk)); if (m) port = Number(m[1]); } })();
  let ws: WebSocket | undefined;
  try {
    for (let n = 0; !port && n < 200; n++) await Bun.sleep(20);
    expect(port).toBeGreaterThan(0);
    expect((await fetch(`http://127.0.0.1:${port}/ws?token=invalid`)).status).toBe(401);
    const token = readFileSync(join(dir, "credentials/token"), "utf8").trim();
    ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    const messages: ServerMessage[] = [];
    ws.onmessage = e => { const m = parseServerMessage(JSON.parse(String(e.data))); if (m) messages.push(m); };
    await new Promise<void>((resolve, reject) => { if (!ws) return reject(); ws.onopen = () => resolve(); ws.onerror = () => reject(new Error("Socket error")); });
    const until = async (predicate: (v: ServerMessage) => boolean) => { for (let n = 0; n < 200; n++) { if (messages.some(predicate)) return; await Bun.sleep(20); } throw new Error("Gate snapshot timed out"); };
    ws.send(JSON.stringify({ type: "gate_list" }));
    await until(m => m.type === "gate_snapshot" && m.items.length === 3);
    ws.send(JSON.stringify({ type: "gate_decide", decision: { action: "approve", ids: [a.id,b.id] } }));
    await until(m => m.type === "gate_snapshot" && m.items.filter(i => i.state === "approved").length === 2);
    ws.send(JSON.stringify({ type: "gate_decide", decision: { action: "edit", id: c.id, body: "Owner-written response" } }));
    await until(m => m.type === "gate_snapshot" && m.items.some(i => i.id === c.id && i.state === "edited"));
    ws.send(JSON.stringify({ type: "gate_decide", decision: { action: "reject", id: c.id, reason: "Need evidence" } }));
    await until(m => m.type === "gate_snapshot" && m.items.some(i => i.id === c.id && i.state === "rejected"));
    expect((await store.show(c.id)).reason).toBe("Need evidence");
  } finally { ws?.close(); proc.kill("SIGTERM"); await proc.exited; await reading; rmSync(dir, { recursive: true, force: true }); }
}, 15000);
