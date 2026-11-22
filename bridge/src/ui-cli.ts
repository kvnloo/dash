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
  dash-ui send '<json>'        Send one raw command object (docs/specs/ui-control.md)

Prints the phone's answer as JSON. Exit 0 when the phone performed it, 1 otherwise, 2 on bad usage.
`;

function commandId(): string {
  return `cli-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
  return { ok: false, error: `unknown command "${verb}"` };
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
