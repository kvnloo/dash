// Laptop-side bridge. One WebSocket endpoint; each `chat` message spawns a
// harness CLI and streams its output back, coalesced into ~40ms frames.

import { hostname } from "node:os";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import qrcode from "qrcode-terminal";
import type { ServerWebSocket } from "bun";
import {
  PROTOCOL_VERSION,
  parseClientMessage,
  type HarnessInfo,
  type ServerMessage,
} from "../../shared/protocol.ts";
import {
  HARNESSES,
  findHarness,
  isInstalled,
  runHarness,
} from "./harnesses.ts";

const PORT = Number(process.env.DASH_PORT ?? 7777);
const DEFAULT_CWD = process.env.DASH_CWD ?? process.cwd();
const FLUSH_MS = 40;

interface SocketData {
  turns: Map<string, AbortController>;
}

type Socket = ServerWebSocket<SocketData>;

function loadToken(): string {
  const dir = join(process.env.HOME ?? ".", ".dash");
  const file = join(dir, "token");
  try {
    const existing = readFileSync(file, "utf8").trim();
    if (existing.length >= 16) return existing;
  } catch {
    // first run
  }
  mkdirSync(dir, { recursive: true });
  const token = crypto.randomUUID().replace(/-/g, "");
  writeFileSync(file, token, { mode: 0o600 });
  return token;
}

async function tailscaleAddresses(): Promise<{ ip?: string; dns?: string }> {
  try {
    const proc = Bun.spawn(["tailscale", "status", "--json"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const text = await new Response(proc.stdout).text();
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return {};
    const self = (parsed as Record<string, unknown>).Self;
    if (typeof self !== "object" || self === null) return {};
    const record = self as Record<string, unknown>;
    const ips = Array.isArray(record.TailscaleIPs) ? record.TailscaleIPs : [];
    const ip = ips.find((value) => typeof value === "string" && value.includes("."));
    const dns = typeof record.DNSName === "string" ? record.DNSName.replace(/\.$/, "") : undefined;
    return {
      ...(typeof ip === "string" ? { ip } : {}),
      ...(dns ? { dns } : {}),
    };
  } catch {
    return {};
  }
}

function send(ws: Socket, message: ServerMessage): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(message));
}

function harnessList(): HarnessInfo[] {
  return HARNESSES.map((harness) => ({
    id: harness.id,
    name: harness.name,
    available: isInstalled(harness),
  }));
}

/** Buffers text deltas and flushes them on a fixed cadence. */
class DeltaBatcher {
  private pending = "";
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ws: Socket,
    private readonly id: string,
  ) {}

  push(text: string): void {
    this.pending += text;
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), FLUSH_MS);
    }
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.length === 0) return;
    send(this.ws, { type: "delta", id: this.id, text: this.pending });
    this.pending = "";
  }
}

async function handleChat(
  ws: Socket,
  turn: { id: string; harness: string; text: string; sessionId?: string; cwd?: string },
): Promise<void> {
  const harness = findHarness(turn.harness);
  if (!harness) {
    send(ws, { type: "error", id: turn.id, message: `unknown harness "${turn.harness}"` });
    send(ws, { type: "done", id: turn.id, exitCode: 1 });
    return;
  }
  if (!isInstalled(harness)) {
    send(ws, { type: "error", id: turn.id, message: `${harness.binary} is not installed on ${hostname()}` });
    send(ws, { type: "done", id: turn.id, exitCode: 1 });
    return;
  }

  const controller = new AbortController();
  ws.data.turns.set(turn.id, controller);
  const batcher = new DeltaBatcher(ws, turn.id);
  let failed = false;

  console.log(`[${turn.id.slice(0, 8)}] ${harness.id} ${turn.sessionId ? "resume" : "new"}: ${turn.text.slice(0, 60)}`);

  try {
    const options = {
      text: turn.text,
      cwd: turn.cwd ?? DEFAULT_CWD,
      ...(turn.sessionId ? { sessionId: turn.sessionId } : {}),
    };
    for await (const event of runHarness(harness, options, controller.signal)) {
      switch (event.kind) {
        case "session":
          send(ws, { type: "session", id: turn.id, sessionId: event.sessionId });
          break;
        case "delta":
          batcher.push(event.text);
          break;
        case "status":
          batcher.flush();
          send(ws, { type: "status", id: turn.id, text: event.text });
          break;
        case "error":
          failed = true;
          batcher.flush();
          send(ws, { type: "error", id: turn.id, message: event.message });
          break;
        default: {
          const _exhaustive: never = event;
          return _exhaustive;
        }
      }
    }
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    send(ws, { type: "error", id: turn.id, message });
  } finally {
    batcher.flush();
    ws.data.turns.delete(turn.id);
    send(ws, { type: "done", id: turn.id, exitCode: failed ? 1 : controller.signal.aborted ? 130 : 0 });
  }
}

const token = loadToken();

const server = Bun.serve<SocketData>({
  hostname: "0.0.0.0",
  port: PORT,
  fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, host: hostname(), version: PROTOCOL_VERSION });
    }
    if (url.pathname !== "/ws") return new Response("dash bridge", { status: 200 });
    if (url.searchParams.get("token") !== token) {
      return new Response("unauthorized", { status: 401 });
    }
    const upgraded = server.upgrade(request, { data: { turns: new Map() } });
    return upgraded ? undefined : new Response("upgrade failed", { status: 400 });
  },
  websocket: {
    idleTimeout: 0,
    open(ws) {
      send(ws, {
        type: "hello",
        version: PROTOCOL_VERSION,
        host: hostname(),
        cwd: DEFAULT_CWD,
        harnesses: harnessList(),
      });
    },
    message(ws, raw) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
      } catch {
        return;
      }
      const message = parseClientMessage(parsed);
      if (!message) return;
      switch (message.type) {
        case "chat":
          void handleChat(ws, message);
          break;
        case "cancel":
          ws.data.turns.get(message.id)?.abort();
          break;
        default: {
          const _exhaustive: never = message;
          return _exhaustive;
        }
      }
    },
    close(ws) {
      for (const controller of ws.data.turns.values()) controller.abort();
      ws.data.turns.clear();
    },
  },
});

const { ip, dns } = await tailscaleAddresses();
const primaryHost = dns ?? ip ?? hostname();
const pairing = `dash://${primaryHost}:${server.port}?token=${token}`;

console.log(`\ndash bridge on ${hostname()}  port ${server.port}  cwd ${DEFAULT_CWD}`);
console.log(`harnesses: ${harnessList().map((h) => `${h.available ? "+" : "-"}${h.id}`).join("  ")}`);
console.log("tools run with approvals bypassed; only pair devices you trust\n");
if (ip) console.log(`  tailscale ip   ${ip}`);
if (dns) console.log(`  tailscale dns  ${dns}`);
console.log(`\nscan in the app, or paste:\n  ${pairing}\n`);
qrcode.generate(pairing, { small: true });
