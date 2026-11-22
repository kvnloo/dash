import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseUiControl, parseUiControlPath, UI_CONTROL_SCHEMA, type UiControlParseResult } from "../../shared/ui-control";

const USAGE = `Usage: dash-ui <command> [args]
Drives the Dash app on the owner's phone through the paired bridge (no taps, no screen reading).
The owner must switch on Dash > Settings > Agent control. Every command shows on the phone.

  dash-ui open "<path>"        Navigate: "Chats", "Chats > <chat title>", "Chats > <chat> > Annotate",
                               "Chats > id:<conversation id>", "Chat", "Settings", "Trace", "Lab",
                               "Orchestra", "Hosts"
  dash-ui circle <target> ["label"]   Circle an element, e.g. dash-ui circle chat-annotate "Tap here"
  dash-ui arrow <target> ["label"]    Arrow pointing at an element
  dash-ui point <target> ["label"]    Pointer dot with an optional label
  dash-ui highlight <testID>          Outline one element
  dash-ui draw "x,y x,y ..." [...]    One stroke per argument, normalized 0..1 window coordinates
  dash-ui clear [id]                  Remove agent marks (all, or the one with that id)
  dash-ui send '<json>'        Send one raw command object (docs/specs/ui-control.md)

  <target> is an element testID (e.g. chat-annotate, chat-window-close, chat-row-<id>) or "x,y"
  in normalized window coordinates. Marks options: --ttl <ms> (250-30000, default 6000),
  --id <id> (to clear it later), --color gold|cream (draw).

Prints the phone's answer as JSON. Exit 0 when the phone performed it, 1 otherwise, 2 on bad usage.
`;

function commandId(): string {
  return `cli-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const DEFAULT_TTL_MS = 6000;

function target(raw: string): { testID: string } | { x: number; y: number } {
  const xy = /^\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*$/.exec(raw);
  return xy ? { x: Number(xy[1]), y: Number(xy[2]) } : { testID: raw };
}

/** Splits --ttl/--id/--color from positional arguments. */
function options(args: readonly string[]): { positional: string[]; ttlMs: number; id?: string; color?: string } | string {
  const positional: string[] = [];
  let ttlMs = DEFAULT_TTL_MS, id: string | undefined, color: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--ttl" || arg === "--id" || arg === "--color") {
      const value = args[++i];
      if (value === undefined) return `${arg} needs a value`;
      if (arg === "--ttl") ttlMs = Number(value); else if (arg === "--id") id = value; else color = value;
    } else positional.push(arg);
  }
  return { positional, ttlMs, ...(id !== undefined ? { id } : {}), ...(color !== undefined ? { color } : {}) };
}

/** Builds the command for argv; separate from transport so callers can extend the verbs. */
export function uiCliCommand(args: readonly string[], id = commandId()): UiControlParseResult | "help" {
  const [verb, ...rest] = args;
  if (verb === undefined || verb === "-h" || verb === "--help" || verb === "help") return "help";
  if (verb === "open") {
    if (rest.length !== 1 || rest[0] === undefined) return { ok: false, error: 'open takes one quoted path, e.g. "Chats > Release notes > Annotate"' };
    return parseUiControlPath(rest[0], id);
  }
  if (verb === "send") {
    if (rest.length !== 1 || rest[0] === undefined) return { ok: false, error: "send takes one JSON command object" };
    let command: unknown;
    try { command = JSON.parse(rest[0]); } catch { return { ok: false, error: "send: invalid JSON" }; }
    return parseUiControl({ type: "ui_control", schema: UI_CONTROL_SCHEMA, command });
  }
  const marks = (command: Record<string, unknown>) => parseUiControl({ type: "ui_control", schema: UI_CONTROL_SCHEMA, command });
  if (verb === "clear") {
    if (rest.length > 1) return { ok: false, error: "clear takes at most one id" };
    return marks({ type: "clear", ...(rest[0] !== undefined ? { id: rest[0] } : {}) });
  }
  if (verb !== "circle" && verb !== "arrow" && verb !== "point" && verb !== "highlight" && verb !== "draw") return { ok: false, error: `unknown command "${verb}"` };
  const parsed = options(rest);
  if (typeof parsed === "string") return { ok: false, error: parsed };
  const markId = parsed.id ?? id;
  if (verb === "draw") {
    if (parsed.positional.length === 0) return { ok: false, error: 'draw takes one or more strokes like "0.1,0.2 0.4,0.5"' };
    const strokes = parsed.positional.map(stroke => ({ points: stroke.trim().split(/\s+/).map(point => point.split(",").map(Number)) }));
    return marks({ type: "draw", id: markId, strokes, ttlMs: parsed.ttlMs, ...(parsed.color !== undefined ? { color: parsed.color } : {}) });
  }
  const [where, label, extra] = parsed.positional;
  if (where === undefined || extra !== undefined) return { ok: false, error: `${verb} takes a target and an optional label` };
  if (verb === "highlight") {
    if (label !== undefined) return { ok: false, error: "highlight takes only a testID" };
    return marks({ type: "highlight", id: markId, testID: where, ttlMs: parsed.ttlMs });
  }
  return marks({ type: "point", id: markId, target: target(where), shape: verb === "point" ? "pointer" : verb, ttlMs: parsed.ttlMs, ...(label !== undefined ? { label } : {}) });
}

export async function uiCli(args: string[], env: NodeJS.ProcessEnv = process.env, build = uiCliCommand): Promise<number> {
  const built = build(args);
  if (built === "help") { process.stdout.write(USAGE); return args.length === 0 ? 2 : 0; }
  if (!built.ok) { process.stderr.write(`dash-ui: ${built.error}\n${USAGE}`); return 2; }
  try {
    const port = Number(env.DASH_NOTICE_PORT ?? (Number(env.DASH_PORT ?? "4747") + 1));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid port");
    const token = readFileSync(join(env.DASH_CREDENTIAL_DIR ?? join(homedir(), ".dash"), "token"), "utf8").trim();
    if (!token || /\s/.test(token)) throw new Error("missing token");
    const response = await fetch(`http://127.0.0.1:${port}/ui-control`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ui_control", schema: UI_CONTROL_SCHEMA, command: built.command }), signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    let answer: unknown;
    try { answer = JSON.parse(text); } catch { answer = null; }
    if (typeof answer !== "object" || answer === null) {
      process.stderr.write(`dash-ui: bridge refused (HTTP ${response.status}): ${text.slice(0, 200)}\n`); return 1;
    }
    process.stdout.write(`${JSON.stringify(answer)}\n`);
    return Reflect.get(answer, "status") === "done" ? 0 : 1;
  } catch {
    process.stderr.write("dash-ui: cannot reach the local Dash bridge; check that it is running\n");
    return 1;
  }
}
