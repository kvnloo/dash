import { join } from "node:path";
import type { Sink, TurnInput } from "../harnesses";
import { AcpClient } from "./client";

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

/** Admission is shared across sockets and released only after process cleanup. */
export class AcpSupervisor {
  private active?: AcpClient;

  async close(): Promise<void> { await this.active?.cancel(); }

  start(options: { id: string; command: string[]; input: TurnInput; sink: Sink; timeoutMs?: number; env?: Record<string, string> }): AcpHandle {
    if (this.active) throw new Error("ACP supervisor busy; concurrency is limited to one turn");
    const client = new AcpClient({ command: options.command, cwd: options.input.cwd, sink: options.sink, timeoutMs: options.timeoutMs, env: options.env });
    this.active = client;
    const done = client.turn(options.input).finally(async () => {
      await client.close();
      this.active = undefined;
    });
    return { done, cancel: () => client.cancel() };
  }
}
