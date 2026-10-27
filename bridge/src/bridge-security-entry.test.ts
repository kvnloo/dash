import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const entrypoint = join(import.meta.dir, "..", "index.ts");

function isolatedEnv(directory: string) {
  return {
    ...process.env,
    HOME: directory,
    PATH: directory,
    DASH_STT_MODEL: join(directory, "no-speech-model"),
    DASH_ALLOW_LOOPBACK: "0",
    DASH_HOST: "0.0.0.0",
  };
}

test("canonical bridge refuses startup without Tailscale before creating credentials", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dash-entry-refuse-"));
  try {
    const proc = Bun.spawn([process.execPath, entrypoint], {
      env: isolatedEnv(directory), stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [status, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(status !== 0).toBe(true);
    expect(stderr.includes("Bridge startup refused")).toBe(true);
    expect(stdout.length).toBe(0);
    expect(existsSync(join(directory, ".dash"))).toBe(false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("canonical isolated bridge authenticates HTTP and WebSocket without printing secrets", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dash-entry-http-"));
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reservation.port;
  reservation.stop(true);
  const proc = Bun.spawn([process.execPath, entrypoint], {
    env: { ...isolatedEnv(directory), DASH_PORT: String(port), DASH_HOST: "127.0.0.1", DASH_ALLOW_LOOPBACK: "1" },
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  const deadline = setTimeout(() => proc.kill("SIGKILL"), 5000);
  try {
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 100; i += 1) {
      try {
        ready = (await fetch(base, { signal: AbortSignal.timeout(100) })).status === 401;
        if (ready) break;
      } catch { /* The child has not bound its test socket yet. */ }
      await Bun.sleep(10);
    }
    expect(ready).toBe(true);
    const bootstrap = readFileSync(join(directory, ".dash", "bootstrap-token"), "utf8").trim();
    const token = readFileSync(join(directory, ".dash", "token"), "utf8").trim();
    expect((await fetch(`${base}/pair`)).status).toBe(401);
    const metadata = await fetch(`${base}/pair`, { headers: { authorization: `Bearer ${bootstrap}` } });
    expect(metadata.status).toBe(200);
    const body: unknown = await metadata.json();
    expect(typeof body === "object" && body !== null && "code" in body && typeof body.code === "string" && body.code.length === 6).toBe(true);
    expect((await fetch(`${base}/ws?token=${bootstrap}`)).status).toBe(401);
    expect((await fetch(`${base}/ws?token=${token}`)).status).toBe(400);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    try {
      const hello = await new Promise<unknown>((resolve, reject) => {
        ws.onmessage = (event) => {
          if (typeof event.data !== "string") return reject(new Error("non-text hello"));
          try { const value: unknown = JSON.parse(event.data); resolve(value); }
          catch { reject(new Error("invalid hello JSON")); }
        };
        ws.onerror = () => reject(new Error("WebSocket handshake failed"));
      });
      expect(typeof hello === "object" && hello !== null && "type" in hello && hello.type === "hello").toBe(true);
    } finally { ws.close(); }
    proc.kill("SIGTERM");
    await proc.exited;
    const output = `${await stdout}\n${await stderr}`;
    expect(output.includes(token)).toBe(false);
    expect(output.includes(bootstrap)).toBe(false);
    if (typeof body === "object" && body !== null && "code" in body && typeof body.code === "string") {
      expect(output.includes(body.code)).toBe(false);
    }
  } finally {
    clearTimeout(deadline);
    if (proc.exitCode === null) { proc.kill("SIGKILL"); await proc.exited; }
    await Promise.all([stdout, stderr]);
    rmSync(directory, { recursive: true, force: true });
  }
});
