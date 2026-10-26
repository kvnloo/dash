import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import { join, resolve } from "node:path";
import { parseServerMessage, type ServerMessage } from "../../../shared/protocol";

function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }

async function bridgeFixture(mode = "ok") {
  const root = await mkdtemp(join(tmpdir(), "dash-bridge-fixture-"));
  const bin = join(root, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "tailscale"), "#!/bin/sh\nexit 1\n", { mode: 0o700 });
  // The bridge probes `hermes gateway list` at startup. The real CLI bootstraps an ~840 MB
  // runtime into HOME (the fixture root) and outlives the bridge, so shim it out.
  await writeFile(join(bin, "hermes"), "#!/bin/sh\nexit 1\n", { mode: 0o700 });
  await writeFile(join(bin, "omp"), `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(join(import.meta.dir, "fixtures/agent.ts"))} ${shellQuote(mode)}\n`, { mode: 0o700 });
  const proc = Bun.spawn([process.execPath, resolve(import.meta.dir, "../../index.ts")], {
    env: { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}`, DASH_ALLOW_LOOPBACK: "1", DASH_HOST: "127.0.0.1", DASH_PORT: "0", DASH_STT_MODEL: join(root, "no-model"), DASH_ALLOWED_ORIGINS: "http://localhost:8100", DASH_ENABLE_LEGACY_CLI: "0", DASH_ACP_FIXTURE_PID: join(root, "agent.pid") },
    stdin: "ignore", stdout: "ignore", stderr: "pipe",
  });
  let stderr = "";
  let port = 0;
  const reading = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr) {
      stderr += decoder.decode(chunk, { stream: true });
      const match = /dash bridge\s+ws:\/\/127\.0\.0\.1:(\d+)/.exec(stderr);
      if (match?.[1]) port = Number(match[1]);
    }
  })();
  for (let i = 0; i < 750 && !port && proc.exitCode === null; i++) await Bun.sleep(20);
  if (!port) {
    proc.kill("SIGKILL"); await proc.exited; await reading; await rm(root, { recursive: true, force: true });
    throw new Error(`Bridge fixture failed to start: ${stderr}`);
  }
  const token = (await readFile(join(root, ".dash/token"), "utf8")).trim();
  const bootstrap = (await readFile(join(root, ".dash/bootstrap-token"), "utf8")).trim();
  return {
    root, port, token, bootstrap, pidFile: join(root, "agent.pid"),
    stderr: () => stderr,
    async close() { if (proc.exitCode === null) proc.kill("SIGTERM"); await proc.exited; await reading; await rm(root, { recursive: true, force: true }); },
  };
}

async function connect(port: number, token: string) {
  const messages: ServerMessage[] = [];
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
  socket.addEventListener("message", event => {
    const raw: unknown = JSON.parse(String(event.data));
    const message = parseServerMessage(raw);
    if (message) messages.push(message);
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("fixture socket failed")), { once: true });
  });
  const until = async (predicate: (value: ServerMessage) => boolean) => {
    for (let i = 0; i < 200; i++) {
      const value = messages.find(predicate);
      if (value) return value;
      await Bun.sleep(10);
    }
    throw new Error("Bridge fixture event timed out");
  };
  return { socket, messages, until, send: (value: unknown) => socket.send(JSON.stringify(value)) };
}

test("canonical bridge auth, stdio response, replay and routing rejection work together", async () => {
  const f = await bridgeFixture();
  let connection: Awaited<ReturnType<typeof connect>> | undefined;
  try {
    expect((await fetch(`http://127.0.0.1:${f.port}/ws?token=invalid`)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${f.port}/pair`)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${f.port}/pair`, { headers: { authorization: `Bearer ${f.bootstrap}` } })).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${f.port}/pair`, { headers: { authorization: `Bearer ${f.bootstrap}`, origin: "https://attacker.invalid" } })).status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${f.port}/pair`, { headers: { authorization: `Bearer ${f.bootstrap}`, host: "attacker.invalid" } })).status).toBe(403);
    const preflight = await fetch(`http://127.0.0.1:${f.port}/pair`, { method: "OPTIONS", headers: { origin: "http://localhost:8100", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:8100");
    const browserPair = await fetch(`http://127.0.0.1:${f.port}/pair`, { headers: { origin: "http://localhost:8100", authorization: `Bearer ${f.bootstrap}` } });
    expect(browserPair.status).toBe(200);
    expect(browserPair.headers.get("access-control-allow-origin")).toBe("http://localhost:8100");
    connection = await connect(f.port, f.token);
    connection.send({ type: "chat", id: "turn", harness: "omp", text: "hi" });
    expect(await connection.until(value => value.type === "done" && value.id === "turn")).toMatchObject({ exitCode: 0 });
    expect(connection.messages.find(value => value.type === "delta")).toMatchObject({ text: "DASH_ACP_OK" });
    expect(connection.messages.find(value => value.type === "session")).toMatchObject({ hostId: hostname(), transport: "acp", sessionId: "fixture-session" });
    expect(connection.messages.find(value => value.type === "status" && value.text === "Running fixture tool")).toMatchObject({ acp: { sessionId: "fixture-session", update: { sessionUpdate: "tool_call", title: "fixture tool", status: "pending" } } });
    connection.socket.close();
    connection = await connect(f.port, f.token);
    connection.send({ type: "attach", turns: [{ id: "turn", seq: 1 }] });
    await connection.until(value => value.type === "done" && value.id === "turn");
    expect(connection.messages.filter(value => "seq" in value).every(value => "seq" in value && value.seq > 1)).toBe(true);
    connection.send({ type: "chat", id: "remote", harness: "omp", text: "hi", hostId: "not-this-host" });
    expect(await connection.until(value => value.type === "error" && value.id === "remote")).toMatchObject({ message: expect.stringContaining("Remote routing unavailable") });
    connection.send({ type: "chat", id: "profile", harness: "hermes", text: "hi", profileId: "not-default" });
    expect(await connection.until(value => value.type === "error" && value.id === "profile")).toMatchObject({ message: expect.stringContaining("Profile routing unavailable") });
    expect(f.stderr().includes(f.token)).toBe(false);
    expect(f.stderr().includes(f.bootstrap)).toBe(false);
  } finally { connection?.socket.close(); await f.close(); }
});

test("canonical wire redacts tool data, caps previews, and fetches full output only for a subscribed turn", async () => {
  const f = await bridgeFixture("parts"); const connection = await connect(f.port, f.token); const stranger = await connect(f.port, f.token);
  try {
    connection.send({ type: "chat", id: "details", harness: "omp", text: "sample" });
    await connection.until(value => value.type === "done" && value.id === "details");
    expect(JSON.stringify(connection.messages)).not.toContain("fixture-private-value");
    const output = connection.messages.find(value => value.type === "status" && value.part?.kind === "tool_output");
    expect(output?.type === "status" && output.part?.kind === "tool_output" ? output.part.text.length : 0).toBe(8192);
    expect(output).toMatchObject({ part: { truncated: true } });
    const legacy = connection.messages.filter(value => value.type === "status" && value.acp);
    expect(JSON.stringify(legacy)).not.toContain("sample output");
    stranger.send({ type: "tool_detail", id: "details", callId: "sample-tool" }); await Bun.sleep(80);
    expect(stranger.messages.some(value => value.type === "status" && value.part?.kind === "tool_detail")).toBe(false);
    connection.send({ type: "tool_detail", id: "details", callId: "sample-tool" });
    const detail = await connection.until(value => value.type === "status" && value.part?.kind === "tool_detail");
    expect(detail?.type === "status" && detail.part?.kind === "tool_detail" ? detail.part.text.length : 0).toBe(10014);
    expect(JSON.stringify(detail)).not.toContain("fixture-private-value");
  } finally { connection.socket.close(); stranger.socket.close(); await f.close(); }
});

test("canonical bridge cancels a live ACP turn and emits one terminal result", async () => {
  const f = await bridgeFixture("hang");
  const connection = await connect(f.port, f.token);
  try {
    connection.send({ type: "chat", id: "cancel", harness: "omp", text: "hi" });
    await connection.until(value => value.type === "session");
    connection.send({ type: "cancel", id: "cancel" });
    expect(await connection.until(value => value.type === "done")).toMatchObject({ exitCode: 130 });
    expect(connection.messages.filter(value => value.type === "done").length).toBe(1);
  } finally { connection.socket.close(); await f.close(); }
});

test("bridge shutdown cancels its owned ACP process before exiting", async () => {
  const f = await bridgeFixture("hang");
  const connection = await connect(f.port, f.token);
  let pid: number | undefined;
  try {
    connection.send({ type: "chat", id: "shutdown", harness: "omp", text: "hi" });
    await connection.until(value => value.type === "session");
    pid = Number(await readFile(f.pidFile, "utf8"));
    connection.socket.close();
    await f.close();
    expect(f.stderr()).toContain("bridge.stopped");
    for (let i = 0; i < 30; i++) {
      try { process.kill(pid, 0); } catch { return; }
      await Bun.sleep(10);
    }
    throw new Error("ACP process survived bridge shutdown");
  } finally {
    connection.socket.close();
    if (pid) { try { process.kill(pid, "SIGKILL"); } catch {} }
    await f.close();
  }
});

test("fixture leaves no HOME and no process behind after close", async () => {
  const f = await bridgeFixture();
  await Bun.sleep(3000);
  await f.close();
  await Bun.sleep(2000);
  const survivors = Bun.spawnSync(["pgrep", "-f", f.root]).stdout.toString().trim();
  const exists = await stat(f.root).then(() => true, () => false);
  expect({ exists, survivors }).toEqual({ exists: false, survivors: "" });
}, 15000);
