import { hostname } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type { ServerWebSocket } from "bun";
import {
  PROTOCOL_VERSION,
  parseClientMessage,
  type ClientMessage,
  type ServerMessage,
} from "../../shared/protocol";
import { CONFIG_PATH, loadConfig } from "./config";
import { findHarness, listHarnesses } from "./harnesses";
import { log } from "./log";
import { Turn, type Sink } from "./turn";

const TURN_RETENTION_MS = 15 * 60 * 1000;

const config = await loadConfig(process.env);
const turns = new Map<string, Turn>();

interface SocketData {
  /** Sinks this socket has attached to turns, so we can detach on close. */
  sinks: Map<string, Sink>;
}

type Socket = ServerWebSocket<SocketData>;

function send(ws: Socket, message: ServerMessage): void {
  ws.send(JSON.stringify(message));
}

function attach(ws: Socket, turn: Turn, fromSeq: number): void {
  const existing = ws.data.sinks.get(turn.id);
  if (existing) turn.detach(existing);
  const sink: Sink = (event) => send(ws, event);
  ws.data.sinks.set(turn.id, sink);
  turn.attach(sink, fromSeq);
}

function resolveCwd(requested: string | undefined): string {
  if (!requested) return config.cwd;
  return isAbsolute(requested) ? requested : resolve(config.cwd, requested);
}

function onChat(ws: Socket, message: Extract<ClientMessage, { type: "chat" }>): void {
  const reject = (text: string) =>
    send(ws, { type: "error", id: message.id, seq: 1, message: text });
  if (turns.has(message.id)) return reject("Duplicate turn id");
  const harness = findHarness(message.harness);
  if (!harness) return reject(`Unknown harness "${message.harness}"`);
  if (Bun.which(harness.bin) === null) {
    return reject(`${harness.name} is not installed on ${hostname()} (no "${harness.bin}" on PATH)`);
  }
  const turn = new Turn(harness, message.id, {
    prompt: message.text,
    sessionId: message.sessionId,
    cwd: resolveCwd(message.cwd),
  });
  turns.set(turn.id, turn);
  attach(ws, turn, 0);
  turn.start();
}

function onMessage(ws: Socket, raw: string | Buffer): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
  } catch {
    return;
  }
  const message = parseClientMessage(parsed);
  if (!message) {
    log.warn("bad client message", { raw: String(raw).slice(0, 200) });
    return;
  }
  switch (message.type) {
    case "chat":
      onChat(ws, message);
      return;
    case "cancel":
      turns.get(message.id)?.cancel();
      return;
    case "attach":
      for (const { id, seq } of message.turns) {
        const turn = turns.get(id);
        if (turn) attach(ws, turn, seq);
        else send(ws, { type: "lost", id });
      }
      return;
    default: {
      const _exhaustive: never = message;
      return _exhaustive;
    }
  }
}

function sweepTurns(): void {
  const cutoff = Date.now() - TURN_RETENTION_MS;
  for (const [id, turn] of turns) {
    if (turn.finished && turn.finishedAt < cutoff) turns.delete(id);
  }
}
setInterval(sweepTurns, 60_000);

const server = Bun.serve<SocketData>({
  hostname: "0.0.0.0",
  port: config.port,
  fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, host: hostname(), version: PROTOCOL_VERSION });
    }
    if (url.pathname === "/ws") {
      const token = (url.searchParams.get("token") ?? "").trim().toLowerCase();
      if (token !== config.token.toLowerCase()) {
        log.warn("rejected connection", { from: server.requestIP(request)?.address });
        return new Response("Unauthorized", { status: 401 });
      }
      const upgraded = server.upgrade(request, { data: { sinks: new Map() } });
      return upgraded ? undefined : new Response("Expected WebSocket", { status: 400 });
    }
    return new Response("dash bridge", { status: 200 });
  },
  websocket: {
    idleTimeout: 120,
    sendPings: true,
    open(ws) {
      log.info("client connected", { from: ws.remoteAddress });
      send(ws, {
        type: "hello",
        version: PROTOCOL_VERSION,
        host: hostname(),
        cwd: config.cwd,
        harnesses: listHarnesses(),
      });
    },
    message(ws, raw) {
      onMessage(ws, raw);
    },
    close(ws) {
      // Turns keep running; the phone re-attaches with its last seq.
      for (const [id, sink] of ws.data.sinks) turns.get(id)?.detach(sink);
      ws.data.sinks.clear();
      log.info("client disconnected", { from: ws.remoteAddress });
    },
  },
});

async function tailscaleIPv4(): Promise<string | undefined> {
  if (Bun.which("tailscale") === null) return undefined;
  const proc = Bun.spawn(["tailscale", "ip", "-4"], { stdout: "pipe", stderr: "ignore" });
  const text = (await new Response(proc.stdout).text()).trim();
  return text || undefined;
}

const ip = await tailscaleIPv4();
const available = listHarnesses().filter((h) => h.available).map((h) => h.name);
process.stdout.write(
  [
    "",
    `  dash bridge on ${hostname()}  ·  port ${server.port}  ·  cwd ${config.cwd}`,
    `  harnesses: ${available.length ? available.join(", ") : "none found on PATH"}`,
    "",
    "  In the app, connect to:",
    `    address  ${ip ?? "<this machine's Tailscale IP>"}:${server.port}`,
    `    token    ${config.token}`,
    "",
    `  config: ${CONFIG_PATH}   (env overrides: DASH_PORT, DASH_TOKEN, DASH_CWD)`,
    "",
  ].join("\n"),
);
