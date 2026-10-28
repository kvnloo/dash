import { join } from "node:path";
import type { Sink, TurnInput } from "../harnesses";
import { acpContextReadings } from "./context";
import { AcpClient, type AcpOptions } from "./client";

const adapterBin = join(import.meta.dir, "../../acp-adapters/node_modules/.bin");

export function acpCommand(id: string, which: (bin: string) => string | null = Bun.which): string[] | null {
  let bin: string;
  let args: string[];
  switch (id) {
    case "omp": bin = "omp"; args = ["acp"]; break;
    case "hermes": bin = "hermes"; args = ["acp"]; break;
    case "grok": bin = "grok"; args = ["agent", "--no-leader", "stdio"]; break;
    case "claude": bin = which("claude-agent-acp") ?? join(adapterBin, "claude-agent-acp"); args = []; break;
    case "codex": bin = which("codex-acp") ?? join(adapterBin, "codex-acp"); args = []; break;
    default: return null;
  }
  const executable = which(bin);
  return executable ? [executable, ...args] : null;
}

export type AcpHandle = { done: Promise<string>; cancel(): Promise<void> };

/** Turns in different chats run side by side; turns in the same chat wait for the one ahead. */
export class AcpSupervisor {
  private readonly active = new Set<AcpClient>();
  private readonly lanes = new Map<string, Promise<unknown>>();

  constructor(private readonly limit = Number(process.env.DASH_ACP_MAX_TURNS ?? 8)) {}

  async close(): Promise<void> { await Promise.all([...this.active].map(c => c.cancel())); }

  start(options: { id: string; command: string[]; input: TurnInput; sink: Sink; timeoutMs?: number; spawnCwd?: string; env?: Record<string, string>; permissions?: AcpOptions["permissions"] }): AcpHandle {
    if (this.active.size >= this.limit) throw new Error(`The host is already running ${this.active.size} agent turns; try again when one finishes.`);
    const client = new AcpClient({ command: options.command, cwd: options.input.cwd, spawnCwd: options.spawnCwd, sink: options.sink, timeoutMs: options.timeoutMs, env: options.env, permissions: options.permissions, onUsage: (session, update) => acpContextReadings.observe(options.id, session, update) });
    this.active.add(client);
    // A new chat has no session yet, so it never waits on another turn.
    const lane = options.input.sessionId ? `${options.id}:${options.input.sessionId}` : undefined;
    const ahead = lane ? this.lanes.get(lane) : undefined;
    let cancelled = false;
    const run = async (): Promise<string> => {
      if (ahead) await ahead.catch(() => undefined);
      if (cancelled) throw new Error("ACP turn cancelled");
      return client.turn(options.input);
    };
    const done = run().finally(async () => {
      await client.close();
      this.active.delete(client);
      if (lane && this.lanes.get(lane) === done) this.lanes.delete(lane);
    });
    if (lane) this.lanes.set(lane, done);
    return { done, cancel: async () => { cancelled = true; await client.cancel(); } };
  }
}
