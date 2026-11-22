import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const USAGE = 'Usage: dash-sudo [--reason "why"] [--] command [args…]\n' +
  "Runs one command with sudo after the owner enters the password on their phone (Dash).\n" +
  "The password goes from the phone, sealed to the bridge, straight into sudo; you only see the command's output.\n";

function result(raw: unknown): { outcome: string; exitCode: number | null; stdout: string; stderr: string; message: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const outcome: unknown = Reflect.get(raw, "outcome"), exitCode: unknown = Reflect.get(raw, "exitCode");
  const stdout: unknown = Reflect.get(raw, "stdout"), stderr: unknown = Reflect.get(raw, "stderr"), message: unknown = Reflect.get(raw, "message");
  if (typeof outcome !== "string" || !(exitCode === null || typeof exitCode === "number") || typeof stdout !== "string" || typeof stderr !== "string") return null;
  return { outcome, exitCode, stdout, stderr, message: typeof message === "string" ? message : "" };
}

export async function sudoCli(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let reason: string | undefined;
  let i = 0;
  for (; i < args.length; i++) {
    if (args[i] === "--reason" && args[i + 1] !== undefined) { reason = args[++i]; continue; }
    if (args[i] === "--") { i++; break; }
    if (args[i] === "-h" || args[i] === "--help") { process.stdout.write(USAGE); return 0; }
    break;
  }
  const argv = args.slice(i);
  if (argv.length === 0) { process.stderr.write(USAGE); return 2; }
  try {
    const port = Number(env.DASH_NOTICE_PORT ?? (Number(env.DASH_PORT ?? "4747") + 1));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid port");
    const token = readFileSync(join(env.DASH_CREDENTIAL_DIR ?? join(homedir(), ".dash"), "token"), "utf8").trim();
    if (!token || /\s/.test(token)) throw new Error("missing token");
    const response = await fetch(`http://127.0.0.1:${port}/secret/sudo`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ argv, cwd: process.cwd(), ...(reason ? { reason } : {}) }), signal: AbortSignal.timeout(20 * 60_000),
    });
    if (!response.ok) { process.stderr.write(`dash-sudo: bridge refused (HTTP ${response.status}): ${(await response.text()).slice(0, 200)}\n`); return 1; }
    const run = result(await response.json());
    if (!run) throw new Error("invalid response");
    process.stdout.write(run.stdout);
    process.stderr.write(run.stderr);
    if (run.outcome !== "delivered") { process.stderr.write(`dash-sudo: ${run.outcome}: ${run.message}\n`); return 1; }
    return run.exitCode ?? 1;
  } catch {
    process.stderr.write("dash-sudo: cannot reach the local Dash bridge; check that it is running\n");
    return 1;
  }
}
