import { expect, test } from "bun:test";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");

async function freePort(): Promise<number> {
  const server = createServer();
  return await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not bind an isolated bridge test port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function ready(url: string, child: ReturnType<typeof spawn>): Promise<void> {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Isolated Dash bridge exited before serving");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(750) });
      if (response.status === 401) return;
      throw new Error(`Trace endpoint returned ${response.status} before authentication`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Trace endpoint returned")) throw error;
    }
    await Bun.sleep(100);
  }
  throw new Error("Isolated Dash bridge did not serve /trace/snapshot");
}

test("real Dash bridge mounts the trace endpoint with bearer-only authorization", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dash-trace-bridge-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/trace/snapshot`;
  const child = spawn(process.execPath, [join(root, "bridge/index.ts")], {
    cwd: root,
    env: {
      ...process.env,
      HOME: directory,
      DASH_CREDENTIAL_DIR: join(directory, ".dash"),
      DASH_HOST: "127.0.0.1",
      DASH_ALLOW_LOOPBACK: "1",
      DASH_PORT: String(port),
      DASH_GATE_ENABLED: "0",
      DASH_LEGACY_TOKEN: "1",
    },
    stdio: "ignore",
  });
  try {
    await ready(url, child);
    const path = join(directory, ".dash", "token");
    expect(existsSync(path)).toBe(true);
    const token = readFileSync(path, "utf8").trim();
    expect(token.length).toBeGreaterThanOrEqual(16);
    expect((await fetch(`${url}?token=${encodeURIComponent(token)}`)).status).toBe(401);
    expect((await fetch(url, { headers: { Authorization: "Bearer wrong-token" } })).status).toBe(401);
    const authorized = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get("cache-control")).toBe("no-store");
    const body: unknown = await authorized.json();
    expect(body).toMatchObject({ schema: "dash.trace.snapshot/v1" });
    expect((await fetch(`http://127.0.0.1:${port}/trace/artifact?path=/etc/passwd`, {
      headers: { Authorization: `Bearer ${token}` },
    })).status).toBe(404);
    expect((await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Origin: "https://untrusted.example" },
    })).status).toBe(403);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([new Promise(resolve => child.once("exit", resolve)), Bun.sleep(2000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);
