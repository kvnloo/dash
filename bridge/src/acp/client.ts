import { acpParts, PartEmitter } from "../reply-parts";
import { TurnPhase } from "../turn-phase";
import { acpToolPhase } from "./phase";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseCommands, type CommandSuggestion } from "../../../shared/suggestions";
import type { Sink, TurnInput } from "../harnesses";
import { AcpPermissionAdapter, type AcpPermissionBrokerPort } from "./permission-adapter";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Images inlined as ACP image blocks only up to this size; larger ones go as links. */
export const ACP_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

function promptImages(initialized: unknown): boolean {
  if (!record(initialized) || !record(initialized.agentCapabilities)) return false;
  const prompt = initialized.agentCapabilities.promptCapabilities;
  return record(prompt) && prompt.image === true;
}

/**
 * The text block (which already lists every path), then one block per attachment: an inline
 * image when the agent advertises image prompts, otherwise a `resource_link`, which every ACP
 * agent must accept. Unreadable files fall back to the link.
 */
export function acpPromptBlocks(input: Pick<TurnInput, "text" | "attachments">, images: boolean, read: (path: string) => Buffer = path => readFileSync(path)): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [{ type: "text", text: input.text }];
  for (const file of input.attachments ?? []) {
    if (images && /^image\/(png|jpeg|gif|webp)$/.test(file.mime) && file.size <= ACP_INLINE_IMAGE_BYTES) {
      try {
        blocks.push({ type: "image", mimeType: file.mime, data: read(file.path).toString("base64"), uri: pathToFileURL(file.path).href });
        continue;
      } catch { /* fall through to a link */ }
    }
    blocks.push({ type: "resource_link", uri: pathToFileURL(file.path).href, name: file.name, mimeType: file.mime, size: file.size });
  }
  return blocks;
}

/** Only a closed set of diagnostic templates may cross from an agent onto the phone. */
export function acpRequestFailure(error: unknown, phase: string): string {
  const code = record(error) && typeof error.code === "number" && Number.isFinite(error.code) ? error.code : "unknown";
  const detail = record(error) && record(error.data) && typeof error.data.details === "string" ? error.data.details : "";
  const model = /^Could not restore model ([\w./:-]{1,80})$/.exec(detail)?.[1];
  const data = record(error) && record(error.data) ? error.data : {};
  const status = typeof data.http_status === "number" ? data.http_status : undefined;
  const text = [detail, typeof data.message === "string" ? data.message : "", record(error) && typeof error.message === "string" ? error.message : ""].join(" ");
  // Only the fixed sentences below reach the phone, never the provider's own text.
  const outOfUsage = status === 402 || /payment required|balance exhausted|out of (usage|credits)|usage limit|quota exceeded|insufficient (credit|balance|quota)/i.test(text);
  const rateLimited = status === 429 || /rate.?limit|too many requests/i.test(text);
  const hint = model ? `could not restore model ${model}; the host may have lost provider login`
    : outOfUsage ? "the agent's provider account is out of usage or credits on this host"
    : rateLimited ? "the agent's provider is rate limiting this host; try again shortly"
    : "check host authentication and agent diagnostics";
  return `ACP request failed during ${phase} (code ${code}); ${hint}`;
}

type Pending = { resolve(value: unknown): void; reject(error: Error): void };
/**
 * `cwd` is the session's working directory, sent to the agent. `spawnCwd` is where the adapter
 * process starts when `cwd` is on another computer (the command then reaches that computer).
 * `timeoutMs` defaults to and is normally capped at 2 minutes; a caller may pass up to an hour.
 */
export type AcpOptions = { command: string[]; cwd: string; spawnCwd?: string; timeoutMs?: number; sink: Sink; env?: Record<string, string>; onUsage?(session: string, update: unknown): void;
  /** Routes session/request_permission to the owner. Absent: every request is cancelled (fail closed). */
  permissions?: { principalId: string; turnId: string; broker: AcpPermissionBrokerPort } };

/** One owned stdio connection. Client capabilities are deliberately empty. */
export class AcpClient {
  private proc: ChildProcessWithoutNullStreams;
  private pending = new Map<number, Pending>();
  private sequence = 0;
  private sessionId?: string;
  private prompting = false;
  private promptRequest?: Promise<unknown>;
  private phaseUpdate?: Record<string, unknown>;
  private parts = new PartEmitter(part => this.options.sink.part?.(part));
  private thinking = new TurnPhase(text => this.options.sink.status(text, this.phaseUpdate && this.sessionId ? { sessionId: this.sessionId, update: this.phaseUpdate } : undefined));
  private used = false;
  private catalogOnly = false;
  private catalogs = new Map<string, CommandSuggestion[]>();
  private commandReady?: () => void;

  /** Metadata only: never sends a prompt or accepts client tool capabilities. */
  async discoverCommands(cwd: string): Promise<CommandSuggestion[]> {
    this.catalogOnly = true;
    await this.turn({ text: "", cwd });
    return this.catalogs.get(this.sessionId ?? "") ?? [];
  }
  private failure?: Error;
  private timer: ReturnType<typeof setTimeout>;
  private exit: Promise<void>;
  private closing?: Promise<void>;
  exited = false;
  phase = "starting";
  negotiated?: { protocolVersion: number; name?: string; version?: string; loadSession: boolean };

  get exitCode(): number | null { return this.proc.exitCode; }
  get exitSignal(): NodeJS.Signals | null { return this.proc.signalCode; }

  private permissions: AcpPermissionAdapter;

  constructor(private options: AcpOptions) {
    if (options.command.length === 0) throw new Error("ACP executable unavailable");
    this.permissions = new AcpPermissionAdapter({
      activeSessionId: () => this.sessionId,
      principalId: options.permissions?.principalId ?? "",
      turnId: options.permissions?.turnId ?? "",
      broker: options.permissions?.broker,
      send: response => this.send(response),
      resolved: () => this.options.sink.status("Thinking"),
    });
    this.proc = spawn("nice", ["-n", "10", ...options.command], {
      cwd: options.spawnCwd ?? options.cwd,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...options.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    this.exit = new Promise(resolve => {
      this.proc.once("close", () => {
        this.exited = true;
        this.fail(new Error("ACP process exited before completion"));
        resolve();
      });
    });
    this.proc.once("error", () => this.fail(new Error("ACP process could not start")));
    this.proc.stdin.on("error", () => this.fail(new Error("ACP input closed")));
    // Drain diagnostics without putting provider credentials into phone events or receipts.
    this.proc.stderr.resume();
    let rest = "";
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => {
      rest += chunk;
      if (Buffer.byteLength(rest) > 1024 * 1024) {
        this.fail(new Error("ACP frame exceeds 1 MiB"));
        this.kill("SIGKILL");
        return;
      }
      for (;;) {
        const end = rest.indexOf("\n");
        if (end < 0) break;
        const line = rest.slice(0, end);
        rest = rest.slice(end + 1);
        if (line.trim()) this.receive(line);
      }
    });
    const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 120_000, 1), 60 * 60_000);
    this.timer = setTimeout(() => {
      this.fail(new Error("ACP turn timed out"));
      this.kill("SIGKILL");
    }, timeoutMs);
  }

  private kill(signal: NodeJS.Signals): void {
    if (!this.proc.pid) return;
    try { process.kill(-this.proc.pid, signal); }
    catch { if (!this.exited) this.proc.kill(signal); }
  }

  private fail(error: Error): void {
    this.failure ??= error;
    for (const pending of this.pending.values()) pending.reject(this.failure);
    this.pending.clear();
  }

  private send(value: unknown): void {
    if (!this.proc.stdin.destroyed) this.proc.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private receive(line: string): void {
    let message: unknown;
    try { message = JSON.parse(line); }
    catch { this.fail(new Error("ACP invalid JSON frame")); return; }
    if (!record(message) || message.jsonrpc !== "2.0") {
      this.fail(new Error("ACP invalid JSON-RPC envelope"));
      return;
    }
    if (typeof message.method === "string") {
      if (message.id !== undefined) {
        if (!this.permissions.receive(message)) {
          this.send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Client capability unavailable" } });
        }
      } else if (message.method === "session/update" && record(message.params)) {
        const params = message.params;
        if (record(params.update) && params.update.sessionUpdate === "available_commands_update" && typeof params.sessionId === "string") {
          this.catalogs.set(params.sessionId, parseCommands(params.update.availableCommands));
          if (params.sessionId === this.sessionId) this.commandReady?.();
          return;
        }
        if (!this.sessionId || params.sessionId !== this.sessionId || !record(params.update)) return;
        if (params.update.sessionUpdate === "usage_update") { this.options.onUsage?.(this.sessionId, params.update); return; }
        if (!this.prompting) return;
        const update = params.update;
        acpParts(update, this.parts);
        switch (update.sessionUpdate) {
          case "agent_message_chunk":
            if (record(update.content) && update.content.type === "text" && typeof update.content.text === "string") {
              this.thinking.text();
              this.options.sink.delta(update.content.text);
            }
            break;
          case "agent_thought_chunk":
            this.thinking.thinking();
            break;
          case "tool_call":
          case "tool_call_update":
            this.phaseUpdate = update;
            acpToolPhase(this.thinking, update);
            this.phaseUpdate = undefined;
            break;
          case "plan": this.options.sink.status("Plan updated", { sessionId: this.sessionId, update }); break;
        }
      }
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error !== undefined) {
      pending.reject(new Error(acpRequestFailure(message.error, this.phase)));
    } else if ("result" in message) pending.resolve(message.result);
    else pending.reject(new Error("ACP response missing result"));
  }

  async turn(input: TurnInput): Promise<string> {
    if (this.used) throw new Error("ACP connection already used");
    this.used = true;
    this.phase = "initialize";
    const initialized = await this.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "dash-bridge", version: "0.1.0" },
      clientCapabilities: {},
    });
    if (!record(initialized) || initialized.protocolVersion !== 1) throw new Error("ACP protocol version unavailable");
    this.negotiated = {
      protocolVersion: initialized.protocolVersion,
      name: record(initialized.agentInfo) && typeof initialized.agentInfo.name === "string" ? initialized.agentInfo.name : undefined,
      version: record(initialized.agentInfo) && typeof initialized.agentInfo.version === "string" ? initialized.agentInfo.version : undefined,
      loadSession: record(initialized.agentCapabilities) && initialized.agentCapabilities.loadSession === true,
    };
    this.phase = input.sessionId ? "session/load" : "session/new";
    if (input.sessionId) {
      if (!record(initialized.agentCapabilities) || initialized.agentCapabilities.loadSession !== true) {
        throw new Error("ACP session loading unavailable for this agent");
      }
      this.sessionId = input.sessionId;
      // session/resume reopens the session without streaming its whole history back (a long
      // Claude Code session is hundreds of MB); the phone already has the history. Else load.
      const resume = record(initialized.agentCapabilities.sessionCapabilities) && record(initialized.agentCapabilities.sessionCapabilities.resume);
      this.phase = resume ? "session/resume" : "session/load";
      await this.request(this.phase, { sessionId: input.sessionId, cwd: input.cwd, mcpServers: [] });
    } else {
      const session = await this.request("session/new", { cwd: input.cwd, mcpServers: [] });
      if (!record(session) || typeof session.sessionId !== "string" || !session.sessionId) {
        throw new Error("ACP agent did not provide a session id");
      }
      this.sessionId = session.sessionId;
    }
    if (this.catalogOnly) {
      if (!this.catalogs.has(this.sessionId)) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 3000);
          this.commandReady = () => { clearTimeout(timer); resolve(); };
        });
        this.commandReady = undefined;
      }
      if (!this.catalogs.has(this.sessionId)) throw new Error("The harness did not advertise commands over ACP.");
      return "metadata";
    }
    this.options.sink.session(this.sessionId);
    this.prompting = true;
    this.phase = "session/prompt";
    this.promptRequest = this.request("session/prompt", {
      sessionId: this.sessionId,
      prompt: acpPromptBlocks(input, promptImages(initialized)),
    });
    const result = await this.promptRequest;
    this.prompting = false;
    if (!record(result) || typeof result.stopReason !== "string") throw new Error("ACP prompt missing stop reason");
    if (result.stopReason === "cancelled") throw new Error("ACP turn cancelled");
    this.phase = "complete";
    return result.stopReason;
  }

  async cancel(): Promise<void> {
    if (this.sessionId) this.send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: this.sessionId } });
    if (this.promptRequest) {
      // Keep stdin and the process alive until the agent handles cancel. An unresponsive
      // agent still gets the existing forced shutdown after this bounded grace period.
      let grace: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.promptRequest.then(() => undefined, () => undefined),
          this.exit,
          new Promise<void>(resolve => { grace = setTimeout(resolve, 1500); }),
        ]);
      } finally {
        clearTimeout(grace);
      }
    }
    this.fail(new Error("ACP turn cancelled"));
    await this.close();
  }

  close(): Promise<void> {
    this.closing ??= this.shutdown();
    return this.closing;
  }

  private async shutdown(): Promise<void> {
    clearTimeout(this.timer);
    this.permissions.cleanup();
    this.fail(new Error("ACP connection closed"));
    this.proc.stdin.end();
    this.kill("SIGTERM");
    let force: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.exit, new Promise<void>(resolve => { force = setTimeout(resolve, 500); })]);
    clearTimeout(force);
    // The leader can exit while its children ignore TERM and close their pipes.
    this.kill("SIGKILL");
    await this.exit;
  }
}
